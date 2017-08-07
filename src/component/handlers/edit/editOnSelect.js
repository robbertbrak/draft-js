/**
 * Copyright (c) 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule editOnSelect
 * @flow
 */

'use strict';

var EditorState = require('EditorState');
var ReactDOM = require('ReactDOM');

var getDraftEditorSelection = require('getDraftEditorSelection');

const UserAgent = require('UserAgent');
const Keys = require('Keys');

let isIE = UserAgent.isBrowser('IE <= 11');
let keys = [Keys.HOME, Keys.END, Keys.LEFT, Keys.RIGHT];

function editOnSelect(event): void {
  if (this._blockSelectEvents) {
    return;
  }

  var editorState = this.props.editorState;
  var documentSelection = getDraftEditorSelection(
    editorState,
    ReactDOM.findDOMNode(this.refs.editorContainer).firstChild
  );
  var updatedSelectionState = documentSelection.selectionState;

  if (updatedSelectionState !== editorState.getSelection()) {
    this._previousSelection = editorState.getSelection();
    // Accepting instead of forcing the selection during cursor movements may in rare cases
    // lead to issues with IE and Korean input.
    // To avoid this we always force the selection in IE when a selection change is
    // triggered by a cursor movement.
    let forceSelection = isIE && event && updatedSelectionState.isCollapsed()
        && event.nativeEvent.type === 'keyup' && keys.indexOf(event.nativeEvent.which) >= 0;

    if (documentSelection.needsRecovery || forceSelection) {
      editorState = EditorState.forceSelection(
        editorState,
        updatedSelectionState
      );
    } else {
      editorState = EditorState.acceptSelection(
        editorState,
        updatedSelectionState
      );
    }

    this.update(editorState);
  }
}

module.exports = editOnSelect;
