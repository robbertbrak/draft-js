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
let isWin10 = UserAgent.isPlatform('Windows 10');
let isKoreanOnIE = false;
let lastKoreanCharacter = '';
let nextToLastKoreanCharacter = '';

// Source: https://en.wikipedia.org/wiki/Korean_language_and_computers
const KOREAN_UNICODE_RANGES = [
  [parseInt('AC00', 16), parseInt('D7A3', 16)],
  [parseInt('1100', 16), parseInt('11FF', 16)],
  [parseInt('3130', 16), parseInt('318F', 16)],
  [parseInt('A960', 16), parseInt('A97F', 16)],
  [parseInt('D7B0', 16), parseInt('D7FF', 16)]
];

let isKorean = function(charCode): boolean {
  return KOREAN_UNICODE_RANGES.find((range) => charCode >= range[0] && charCode <= range[1]);
};

var DraftEditorCompositionHandler = {
  onBeforeInput: function(e: SyntheticInputEvent): void {
    // If we are typing Korean on IE11, the input event is unreliable.
    // Instead, we maintain the typed chars in the compositionStart and compositionEnd handlers.
    if (!lastKoreanCharacter) {
      textInputData = (textInputData || '') + e.data;
    }
  },

  /**
   * A `compositionstart` event has fired while we're still in composition
   * mode. Continue the current composition session to prevent a re-render.
   */
  onCompositionStart: function(e): void {
    formerTextInputData = e.data;
    stillComposing = true;

    // For Korean on IE11, continued composition means that the last character in the DOM
    // is the one currently being composed (and is still unfinished).
    // The 'next to last' char is the one that should have been committed in the previous
    // compositionEnd event.
    if (nextToLastKoreanCharacter) {
      textInputData = textInputData.substring(0, textInputData.length - 1) + nextToLastKoreanCharacter;
      nextToLastKoreanCharacter = '';
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
    resolved = false;
    stillComposing = false;

    // For Korean on IE11, the composition end event may not contain
    // the character that has actually been typed when the event is
    // followed by composition start. In this case, we read the proper
    // characters from the DOM.
    lastKoreanCharacter = '';
    nextToLastKoreanCharacter = '';
    if (isIE && e.data && isKorean(e.data.charCodeAt(0))) {
      let domSelection = global.getSelection();
      let content = domSelection.anchorNode.textContent;
      let i = domSelection.anchorOffset - 1;
      while (i >= 0) {
        if (isKorean(content.charCodeAt(i))) {
          isKoreanOnIE = true;
          lastKoreanCharacter = content.charAt(i);
          nextToLastKoreanCharacter = content.charAt(i - 1);
          textInputData = (textInputData || '') + lastKoreanCharacter;
          break;
        }
        i--;
      }
    }

    setTimeout(() => {
      if (!resolved) {
        DraftEditorCompositionHandler.resolveComposition.call(this);
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
  resolveComposition: function(): void {
    if (stillComposing) {
      return;
    }

    resolved = true;

    const wasKoreanOnIE = isKoreanOnIE;
    isKoreanOnIE = false;
    lastKoreanCharacter = '';
    nextToLastKoreanCharacter = '';

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
      var anchorOffset = selection.getAnchorOffset() - formerComposedChars.length;
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
        (wasKoreanOnIE && !isWin10) ? this._previousSelection : selection,
        composedChars,
        currentStyle,
        entityKey
      );
      this.update(
        EditorState.push(
          editorState,
          contentState,
          'insert-characters'
        )
      );
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
