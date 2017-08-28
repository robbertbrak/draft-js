/**
 * Copyright (c) 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule decodeEntityRanges
 * @typechecks
 * @flow
 */

'use strict';

/**
 * Convert to native JavaScript string lengths to determine ranges.
 */
function decodeEntityRanges(
  text: string,
  ranges: Array<Object>
): Array<?string> {
  var entities = Array(text.length).fill(null);
  if (ranges) {
    ranges.forEach(
      range => {
        // Using Unicode-enabled substrings converted to JavaScript lengths,
        // fill the output array with entity keys.
        var start = range.offset;
        var end = start + range.length;
        for (var ii = start; ii < end; ii++) {
          entities[ii] = range.key;
        }
      }
    );
  }
  return entities;
}

module.exports = decodeEntityRanges;
