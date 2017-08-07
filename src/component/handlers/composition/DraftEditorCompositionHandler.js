/**
 * Copyright (c) 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule DraftEditorCompositionHandler
 * @flow
 */

'use strict';

const DraftModifier = require('DraftModifier');
const EditorState = require('EditorState');
const Keys = require('Keys');

const getEntityKeyForSelection = require('getEntityKeyForSelection');
const isSelectionAtLeafStart = require('isSelectionAtLeafStart');

const UserAgent = require('UserAgent');
const isKorean = require('isKorean');

/**
 * Millisecond delay to allow `compositionstart` to fire again upon
 * `compositionend`.
 *
 * This is used for Korean input to ensure that typing can continue without
 * the editor trying to render too quickly. More specifically, Safari 7.1+
 * triggers `compositionstart` a little slower than Chrome/FF, which
 * leads to composed characters being resolved and re-render occurring
 * sooner than we want.
 *
 * However, when typing Korean characters on IE11, we don't need this delay,
 * so we'll ignore it in that case.
 */
const RESOLVE_DELAY = 20;

/**
 * A handful of variables used to track the current composition and its
 * resolution status. These exist at the module level because it is not
 * possible to have compositions occurring in multiple editors simultaneously,
 * and it simplifies state management with respect to the DraftEditor component.
 */
let resolved = false;
let initial = true;
let stillComposing = false;
let textInputData = '';
let formerTextInputData = '';

/**
 * As noted in https://github.com/facebook/draft-js/issues/359 and
 * https://facebook.github.io/draft-js/docs/advanced-topics-issues-and-pitfalls.html#ime-and-internet-explorer,
 * typing Korean in IE11 is very problematic for Draft.
 * In particular, the compositionEnd event in IE11 often does not contain the
 * proper value in the `data` attribute.
 *
 * As an example, when typing 'dufma' (ㅇ ㅕ ㄹ ㅡ ㅁ), the result should be 여름,
 * thus combining the first 2 Jamo and the last 3 Jamo to form 2 Korean characters.
 * During composition, the first 3 Jamo are temporarily combined into 열, but this becomes
 * 여르 as soon as the 4th Jamo is typed.
 *
 * In Chrome, the compositionEnd event with '여' data is fired on typing the 4th Jamo, which is correct.
 * In IE11, however, the compositionEnd event has '열' in the data attribute.
 * Also, there is no other event that gives the right information.
 * Therefore, we HAVE to read the DOM to find out which character was actually typed.
 * Doing so is complicated by some extra factors:
 * - when the compositionEnd event is fired, the DOM may already contain the next Korean character
 *    that is being composed (르 in the above example), but only if the compositionEnd
 *    is followed by another compositionStart event in the same composition session;
 * - composition may be ended in a way that does not generate an input event,
 *    for example when the right arrow key is pressed;
 * - the editor selection state is reset incorrectly as soon as Korean input starts.
 */

let isIE = UserAgent.isBrowser('IE <= 11');
let isEdge = UserAgent.isBrowser('Edge');
let isWin10 = UserAgent.isPlatform('Windows 10');
let isAndroid7 = UserAgent.isPlatform('Android >= 7');
let isKoreanOnIE = false;
let offsetAtCompositionStart = 0;
let anchorNodeAtCompositionStart = null;
let lastKoreanCharacter = '';
let nextToLastKoreanCharacter = '';
let charInCompStart = '';
let charInCompUpdate = '';

var DraftEditorCompositionHandler = {
  onBeforeInput: function(e: SyntheticInputEvent): void {
    // If we are typing Korean on IE11, the input event is unreliable.
    // Instead, we maintain the typed chars in the compositionStart and compositionEnd handlers.
    if (!lastKoreanCharacter && !(isKoreanOnIE && /[\r\n\u001b]/.test(e.data))) {
      if (isEdge && e.data.length > 1 && isKorean(e.data.charAt(0))) {
        // For some reason Edge duplicates the Korean character in the event
        // when terminating a composition session with a mouse click.
        // https://developer.microsoft.com/en-us/microsoft-edge/platform/issues/11014678/
        textInputData = (textInputData || '') + e.data.charAt(0);
      } else {
        textInputData = (textInputData || '') + e.data;
      }
    }
  },

  /**
   * A `compositionstart` event has fired while we're still in composition
   * mode. Continue the current composition session to prevent a re-render.
   */
  onCompositionStart: function(e): void {
    formerTextInputData = e.data;
    stillComposing = true;
    resolved = false;
    charInCompUpdate = '';

    if (isIE) {
      let domSelection = global.getSelection();
      offsetAtCompositionStart = domSelection.anchorOffset - 1;
      anchorNodeAtCompositionStart = domSelection.anchorNode;
    }

    // Using the Korean IME on IE11, when the user types something other than Korean using the IME,
    // it may be that the composition start event contains the typed character, but the
    // composition end does NOT.
    if (isIE && e.data.length == 1 && !isKorean(e.data.charAt(0))) {
      nextToLastKoreanCharacter = '';
      charInCompStart = e.data;
    }

    // For Korean on IE11, continued composition means that the last character in the DOM
    // is the one currently being composed (and is still unfinished).
    // The 'next to last' char is the one that should have been committed in the previous
    // compositionEnd event.
    if (nextToLastKoreanCharacter) {
      textInputData = textInputData.substring(0, textInputData.length - 1) + nextToLastKoreanCharacter;
      nextToLastKoreanCharacter = '';
    }
  },

  onCompositionUpdate: function(e): void {
    // In some cases a composition session is not ended with a key stroke,
    // but with a mouse click, blur event or something else.
    // When typing Korean, the last typed character may be lost
    // if we don't keep track of what happens in the composition update events.
    if (e.data && isKorean(e.data.charAt(0))) {
      charInCompUpdate = e.data;
      isKoreanOnIE = isIE;
    }
  },

  /**
   * Attempt to end the current composition session.
   *
   * Defer handling because browser will still insert the chars into active
   * element after `compositionend`. If a `compositionstart` event fires
   * before `resolveComposition` executes, our composition session will
   * continue.
   *
   * The `resolved` flag is useful because certain IME interfaces fire the
   * `compositionend` event multiple times, thus queueing up multiple attempts
   * at handling the composition. Since handling the same composition event
   * twice could break the DOM, we only use the first event. Example: Arabic
   * Google Input Tools on Windows 8.1 fires `compositionend` three times.
   */
  onCompositionEnd: function(e): void {
    stillComposing = false;

    // For Korean on IE11, the composition end event may not contain
    // the character that has actually been typed when the event is
    // followed by composition start. In this case, we read the proper
    // characters from the DOM.
    lastKoreanCharacter = '';
    nextToLastKoreanCharacter = '';

    if (isIE && !e.data) {
      textInputData += charInCompStart || charInCompUpdate;
      isKoreanOnIE = true;
    }

    if (isIE && e.data && isKorean(e.data.charAt(0))) {
      let content = anchorNodeAtCompositionStart.textContent, i = offsetAtCompositionStart;
      if (!charInCompUpdate) {
        let domSelection = global.getSelection();
        content = domSelection.anchorNode.textContent;
        i = domSelection.anchorOffset - 1;
      }

      if (isKorean(content.charAt(i))) {
        isKoreanOnIE = true;
        lastKoreanCharacter = content.charAt(i);
        nextToLastKoreanCharacter = content.charAt(i - 1);
        textInputData = (textInputData || '') + lastKoreanCharacter;
      }
    }

    // In Android 7+ there is (unlike Android 6-) no textInput event just before ending composition.
    // Rely on the data in the composition end event instead.
    if (isAndroid7 && e.data && !textInputData) {
      textInputData = e.data;
    }

    charInCompStart = '';
    charInCompUpdate = '';

    setTimeout(() => {
      if (!resolved) {
        DraftEditorCompositionHandler.resolveComposition.call(this, 'insert-characters');
      }
    }, isKoreanOnIE ? 0 : RESOLVE_DELAY);
  },

  /**
   * In Safari, keydown events may fire when committing compositions. If
   * the arrow keys are used to commit, prevent default so that the cursor
   * doesn't move, otherwise it will jump back noticeably on re-render.
   */
  onKeyDown: function(e: SyntheticKeyboardEvent): void {
    if (e.which === Keys.RIGHT || e.which === Keys.LEFT) {
      e.preventDefault();
    }
    if (isKoreanOnIE) {
      lastKoreanCharacter = '';
      nextToLastKoreanCharacter = '';
      charInCompUpdate = '';
    }
  },

  /**
   * Keypress events may fire when committing compositions. In Firefox,
   * pressing RETURN commits the composition and inserts extra newline
   * characters that we do not want. `preventDefault` allows the composition
   * to be committed while preventing the extra characters.
   */
  onKeyPress: function(e: SyntheticKeyboardEvent): void {
    if (e.which === Keys.RETURN) {
      e.preventDefault();
    }
  },

  /**
   * Blurring leads to composition termination without a compositionend event.
   * Make sure we do terminate the composition session using whatever data we have.
   */
  onBlur: function(e: SyntheticKeyboardEvent): void {
    e.preventDefault();
    stillComposing = false;
    textInputData = (textInputData || '') + charInCompUpdate;
    DraftEditorCompositionHandler.resolveComposition.call(this, 'commit-blurred-composition');
  },

  /**
   * Attempt to insert composed characters into the document.
   *
   * If we are still in a composition session, do nothing. Otherwise, insert
   * the characters into the document and terminate the composition session.
   *
   * If no characters were composed -- for instance, the user
   * deleted all composed characters and committed nothing new --
   * force a re-render. We also re-render when the composition occurs
   * at the beginning of a leaf, to ensure that if the browser has
   * created a new text node for the composition, we will discard it.
   *
   * Resetting innerHTML will move focus to the beginning of the editor,
   * so we update to force it back to the correct place.
   */
  resolveComposition: function(editorChangeType: string): void {
    if (stillComposing) {
      return;
    }

    resolved = true;
    initial = true;

    const wasKoreanOnIE = isKoreanOnIE;
    isKoreanOnIE = false;
    lastKoreanCharacter = '';
    nextToLastKoreanCharacter = '';
    offsetAtCompositionStart = null;
    anchorNodeAtCompositionStart = null;

    const composedChars = textInputData;
    textInputData = '';

    const formerComposedChars = formerTextInputData;
    formerTextInputData = '';

    const editorState = EditorState.set(this.props.editorState, {
      inCompositionMode: false,
    });

    const currentStyle = editorState.getCurrentInlineStyle();
    const entityKey = getEntityKeyForSelection(
      editorState.getCurrentContent(),
      editorState.getSelection()
    );

    const mustReset = (
      !composedChars ||
      isSelectionAtLeafStart(editorState) ||
      currentStyle.size > 0 ||
      entityKey !== null
    );

    if (mustReset) {
      this.restoreEditorDOM(undefined, ((composedChars && composedChars.length > 0) ? "contentsKey" : "containerKey"));
    }

    this.exitCurrentMode();
    this.removeRenderGuard();

    let contentState = editorState.getCurrentContent();
    let selection = editorState.getSelection();
    if (!wasKoreanOnIE && formerComposedChars && selection.isCollapsed()) {
      let anchorOffset = selection.getAnchorOffset() - formerComposedChars.length;
      if (anchorOffset < 0) {
        anchorOffset = 0;
      }
      const toRemoveSel = selection.merge({anchorOffset});
      contentState = DraftModifier.removeRange(
        editorState.getCurrentContent(),
        toRemoveSel,
        'backward',
      );
      selection = contentState.getSelectionAfter();
    }

    if (composedChars) {
      // If characters have been composed, re-rendering with the update
      // is sufficient to reset the editor.
      // For Korean on IE11, the desired selection to replace will have
      // been overwritten at the start of the composition session, so we'll reset it here.
      contentState = DraftModifier.replaceText(
        contentState,
        (wasKoreanOnIE && !isWin10 && this._previousSelection) ? this._previousSelection : selection,
        composedChars,
        currentStyle,
        entityKey
      );
      let newEditorState = EditorState.push(
          editorState,
          contentState,
          editorChangeType
      );
      this.update(newEditorState);
      return;
    }

    if (mustReset) {
      this.update(
        EditorState.set(editorState, {
          nativelyRenderedContent: null,
          forceSelection: true,
        })
      );
    }
  },
};

module.exports = DraftEditorCompositionHandler;
