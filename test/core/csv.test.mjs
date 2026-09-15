import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as c from '../../src/core/csv.js';

test('readCsv names the file and the missing column when it refuses', () => {
  assert.deepEqual(c.readCsv('a,b\n1,2\n', ['a'], 'Links').rows, [{ a: '1', b: '2' }]);
  assert.throws(() => c.readCsv('a,b\n1,2\n', ['c'], 'Links'), /Links: missing column\(s\): c/);
  assert.throws(() => c.readCsv('a,b\n', ['a'], 'Links'), /Links: file is empty/);
  assert.deepEqual(c.readCsv('a,b\n', ['a'], 'Links', true).rows, [], 'unless empty is allowed');
});

test('sameRefs ignores order, because a reordered row is not a changed row', () => {
  assert.ok(c.sameRefs(['L2', 'L1'], ['L1', 'L2']));
  assert.ok(c.sameRefs(null, []));
  assert.ok(!c.sameRefs(['L1'], ['L1', 'L2']));
});

test('outRef strips the in-memory tag the workbook never sees', () => {
  assert.equal(c.outRef('E5000X~2'), 'E5000X');
  assert.equal(c.outRef('E90214'), 'E90214');
  assert.equal(c.PLACEHOLDER_REF, 'E5000X');
});
