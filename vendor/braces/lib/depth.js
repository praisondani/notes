'use strict';

const MAX_DEPTH = 256;

const assertDepth = depth => {
  if (depth > MAX_DEPTH) {
    throw new RangeError(`brace pattern nesting exceeds maximum depth (${MAX_DEPTH})`);
  }
};

module.exports = { MAX_DEPTH, assertDepth };
