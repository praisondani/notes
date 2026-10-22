import assert from 'node:assert/strict';
import braces from 'braces';

const deeplyNested = `${'{'.repeat(1000)}x${'}'.repeat(1000)}`;
const nestedParentheses = `${'('.repeat(1000)}x${')'.repeat(1000)}`;
const depthError = /brace pattern nesting exceeds maximum depth \(256\)/;

assert.throws(() => braces(deeplyNested), depthError);
assert.throws(() => braces.expand(deeplyNested), depthError);
assert.throws(() => braces(nestedParentheses), depthError);
assert.deepEqual(braces.expand('{a,b}'), ['a', 'b']);
assert.equal(braces.compile('{a,b}'), '(a|b)');

const ast = { type: 'root', nodes: [] };
let node = ast;
for (let index = 0; index < 1000; index++) {
  const child = { type: 'brace', nodes: [] };
  node.nodes.push(child);
  node = child;
}
node.nodes.push({ type: 'text', value: 'x' });

assert.throws(() => braces.compile(ast), RangeError);
assert.throws(() => braces.stringify(ast), RangeError);
