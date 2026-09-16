// The id has to be the same for the same fault and different for a different
// one, whoever hits it and whenever - that is the only thing it is for.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { errorId, stackSite } from '../../src/core/errorId.js';

const err = (message, stack) => Object.assign(new Error(message), { stack });
const STACK = 'Error: boom\n    at draw (http://localhost:5200/assets/index-A1b2C3d4.js:120:9)\n    at run (x.js:1:1)';

test('the same fault gets the same id', () => {
  assert.equal(errorId(err('boom', STACK)), errorId(err('boom', STACK)));
});

test('a different fault gets a different id', () => {
  assert.notEqual(errorId(err('boom', STACK)), errorId(err('something else', STACK)));
  const elsewhere = STACK.replace('draw (http://localhost:5200/assets/index-A1b2C3d4.js:120:9',
    'save (http://localhost:5200/assets/index-A1b2C3d4.js:900:3');
  assert.notEqual(errorId(err('boom', STACK)), errorId(err('boom', elsewhere)));
});

test('the id survives a rebuild and another machine', () => {
  const rebuilt = STACK.replace('index-A1b2C3d4.js', 'index-Z9y8X7w6.js').replace('localhost:5200', 'kaizen.example:443');
  assert.equal(errorId(err('boom', STACK)), errorId(err('boom', rebuilt)));
});

test('the same bug on different rows is one id', () => {
  assert.equal(errorId(err('row 47 is missing', STACK)), errorId(err('row 48 is missing', STACK)));
});

test('the id is readable: DAT- and six hex characters', () => {
  assert.match(errorId(err('boom', STACK)), /^DAT-[0-9A-F]{6}$/);
});

test('an error with no stack still gets an id', () => {
  assert.match(errorId(err('boom', undefined)), /^DAT-[0-9A-F]{6}$/);
  assert.match(errorId('a string thrown on its own'), /^DAT-[0-9A-F]{6}$/);
});

test('stackSite strips the host and the build hash', () => {
  assert.equal(stackSite(STACK), '/assets/index.js:120:9');
});

test('where it happened separates two reports of the same message', () => {
  assert.notEqual(errorId(err('boom', STACK), 'layout'), errorId(err('boom', STACK), 'zone'));
});
