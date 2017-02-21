/**
 * Copyright (c) 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule isKorean
 * @typechecks
 * @flow
 */

'use strict';

// Source: https://en.wikipedia.org/wiki/Korean_language_and_computers
const KOREAN_UNICODE_RANGES = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF\uA960-\uA97F\uD7B0-\uD7FF]/;

function isKorean(char): boolean {
  return KOREAN_UNICODE_RANGES.test(char);
}

module.exports = isKorean;
