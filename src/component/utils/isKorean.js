/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 * @flow strict-local
 * @emails oncall+draft_js
 */

'use strict';

// Source: https://en.wikipedia.org/wiki/Korean_language_and_computers
const KOREAN_UNICODE_RANGES = /[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7AF\uA960-\uA97F\uD7B0-\uD7FF]/;

function isKorean(char): boolean {
  return KOREAN_UNICODE_RANGES.test(char);
}

module.exports = isKorean;
