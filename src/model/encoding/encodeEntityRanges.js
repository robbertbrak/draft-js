/**
 * Copyright (c) 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule encodeEntityRanges
 * @typechecks
 * @flow
 */

'use strict';

var DraftStringKey = require('DraftStringKey');

import type ContentBlock from 'ContentBlock';
import type {EntityRange} from 'EntityRange';

/**
 * Convert to UTF-8 character counts for storage.
 */
function encodeEntityRanges(
  block: ContentBlock,
  storageMap: Object
): Array<EntityRange> {
  var encoded = [];
  block.findEntityRanges(
    character => !!character.getEntity(),
    (/*number*/ start, /*number*/ end) => {
      var text = block.getText();
      var key = block.getEntityAt(start);
      encoded.push({
        offset: text.slice(0, start).length,
        length: text.slice(start, end).length,
        // Encode the key as a number for range storage.
        key: Number(storageMap[DraftStringKey.stringify(key)]),
      });
    }
  );
  return encoded;
}

module.exports = encodeEntityRanges;
