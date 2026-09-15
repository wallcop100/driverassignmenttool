import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as n from '../../src/core/nodes.js';

test('a colon in a node name is banned, on a driver output or a panel terminal', () => {
  assert.equal(n.fixNodeName('OP.1:2'), 'OP.1-2');
  assert.equal(n.fixNodeName('A:B'), 'A-B');
  assert.equal(n.fixNodeName('OP.1'), 'OP.1', 'a clean name is untouched');
  assert.ok(n.BANNED_NODE.test('<OP.1:2'));
});

test('bannedNodes reports every type that uses the form, and what each becomes', () => {
  const model = { inventory: [
    { typeRef: 'A', nodes: [{ name: '<OP.1:2' }, { name: '<OP.3' }] },
    { typeRef: 'B', nodes: [{ name: '<OP.1' }] },
    { typeRef: 'C', nodes: [] },
  ] };
  const out = n.bannedNodes(model);
  assert.deepEqual(out.map((x) => x.t.typeRef), ['A']);
  assert.deepEqual(out[0].nodes, [{ from: '<OP.1:2', to: '<OP.1-2' }]);
  assert.deepEqual(n.bannedNodes(null), [], 'no model is not a crash');
});
