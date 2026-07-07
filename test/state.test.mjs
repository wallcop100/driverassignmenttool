// Reducer self-check for the round-2 features (multi-select, redo, revert,
// restore). state.js is pure (no React), so it runs directly under node.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initialState, reducer } from '../src/state.js';

const model = {
  baseline: {
    'D|OP.1': { toEntityType: 'Link', refs: ['X1'] },
    'D|OP.2': { toEntityType: '', refs: [] },
  },
  inventory: [], drivers: [{ ref: 'D' }], links: [],
};
const init = () => reducer(initialState, { type: 'INIT', model });

test('SELECT_LINKS: plain replaces, additive toggles', () => {
  let s = init();
  s = reducer(s, { type: 'SELECT_LINKS', linkRef: 'X1', additive: false });
  assert.deepEqual(s.selectedLinks, ['X1']);
  s = reducer(s, { type: 'SELECT_LINKS', linkRef: 'X2', additive: true });
  assert.deepEqual(s.selectedLinks, ['X1', 'X2']);
  s = reducer(s, { type: 'SELECT_LINKS', linkRef: 'X1', additive: true });
  assert.deepEqual(s.selectedLinks, ['X2']);
  s = reducer(s, { type: 'SELECT_LINKS', linkRef: 'X2', additive: false });
  assert.deepEqual(s.selectedLinks, []); // plain click on the only selection deselects
});

test('MOVE_MANY moves several and clears the selection', () => {
  let s = init();
  s = reducer(s, { type: 'SELECT_LINKS', linkRef: 'X1', additive: false });
  s = reducer(s, { type: 'MOVE_MANY', linkRefs: ['X1'], toKey: 'D|OP.2' });
  assert.deepEqual(s.assignments['D|OP.2'].refs, ['X1']);
  assert.deepEqual(s.assignments['D|OP.1'].refs, []);
  assert.deepEqual(s.selectedLinks, []);
});

test('UNDO then REDO round-trips', () => {
  let s = init();
  s = reducer(s, { type: 'MOVE_MANY', linkRefs: ['X1'], toKey: 'D|OP.2' });
  const moved = JSON.stringify(s.assignments);
  s = reducer(s, { type: 'UNDO' });
  assert.deepEqual(s.assignments['D|OP.1'].refs, ['X1']); // back to baseline
  s = reducer(s, { type: 'REDO' });
  assert.equal(JSON.stringify(s.assignments), moved); // forward again
});

test('a new action clears the redo stack', () => {
  let s = init();
  s = reducer(s, { type: 'MOVE_MANY', linkRefs: ['X1'], toKey: 'D|OP.2' });
  s = reducer(s, { type: 'UNDO' });
  assert.equal(s.redo.length, 1);
  s = reducer(s, { type: 'MOVE_MANY', linkRefs: ['X1'], toKey: 'D|OP.2' });
  assert.equal(s.redo.length, 0);
});

test('REVERT_KEY resets one node to baseline', () => {
  let s = init();
  s = reducer(s, { type: 'MOVE_MANY', linkRefs: ['X1'], toKey: 'D|OP.2' });
  s = reducer(s, { type: 'REVERT_KEY', key: 'D|OP.1' });
  assert.deepEqual(s.assignments['D|OP.1'].refs, ['X1']);
});

test('RESTORE loads a saved session incl. prefs', () => {
  const saved = { model, assignments: { 'D|OP.2': { toEntityType: 'Link', refs: ['X1'] } },
    addedDrivers: [], prefs: { label: ['ref', 'controlGroup'] }, view: { page: 'landing' } };
  const s = reducer(initialState, { type: 'RESTORE', saved });
  assert.equal(s.model, model);
  assert.deepEqual(s.assignments['D|OP.2'].refs, ['X1']);
  assert.deepEqual(s.prefs.label, ['ref', 'controlGroup']);
});

test('distribute mode: mark nodes then DISTRIBUTE applies + clears', () => {
  let s = init();
  s = reducer(s, { type: 'START_DISTRIBUTE', group: 'G' });
  assert.equal(s.distributeGroup, 'G');
  s = reducer(s, { type: 'TOGGLE_DIST_NODE', key: 'D|OP.2' });
  assert.deepEqual(s.distributeNodes, ['D|OP.2']);
  s = reducer(s, { type: 'TOGGLE_DIST_NODE', key: 'D|OP.2' }); // toggle off
  assert.deepEqual(s.distributeNodes, []);
  s = reducer(s, { type: 'TOGGLE_DIST_NODE', key: 'D|OP.2' });
  s = reducer(s, { type: 'DISTRIBUTE', placements: { 'D|OP.2': ['X1'] } });
  assert.deepEqual(s.assignments['D|OP.2'].refs, ['X1']);
  assert.deepEqual(s.assignments['D|OP.1'].refs, []); // X1 moved off its baseline node
  assert.equal(s.distributeGroup, null);
  assert.deepEqual(s.distributeNodes, []);
});

test('SET_PREFS merges label config', () => {
  let s = init();
  s = reducer(s, { type: 'SET_PREFS', prefs: { label: ['loadW', 'controlGroup'] } });
  assert.deepEqual(s.prefs.label, ['loadW', 'controlGroup']);
});
