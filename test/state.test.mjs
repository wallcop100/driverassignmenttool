// Reducer self-check for the round-2 features (multi-select, redo, revert,
// restore). state.js is pure (no React), so it runs directly under node.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cgColor, initialState, reducer, severityOf, zoneControlGroups } from '../src/state.js';

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

test('severityOf: FAIL > MISMATCH > WARN > none, regardless of node/link scoping', () => {
  // CC/CV type, voltage, and mA current checks always carry node+link — a naive
  // filter that drops scoped flags (the DriverBin bug) must not affect this.
  assert.equal(severityOf([]), null);
  assert.equal(severityOf([{ level: 'WARN', node: 'OP.1' }]), 'WARN');
  assert.equal(severityOf([{ level: 'WARN' }, { level: 'MISMATCH', node: 'OP.1', link: 'X1' }]), 'MISMATCH');
  assert.equal(severityOf([{ level: 'MISMATCH', node: 'OP.1', link: 'X1' }, { level: 'FAIL' }]), 'FAIL');
});

test('regression guard: driver-level rollup must not drop node/link-scoped flags', () => {
  // This is the exact shape of the bug: TypeMatch/CVVoltage/CurrentMatch flags
  // always set `node` and usually `link`. A driver-level view built by filtering
  // those out (as DriverBin.jsx once did) silently loses every CC/CV + mA issue.
  const flags = [
    { driver: 'D1', node: 'OP.1', link: 'X1', level: 'MISMATCH', check: 'TypeMatch' },
    { driver: 'D1', node: 'OP.1', link: 'X1', level: 'MISMATCH', check: 'CurrentMatch' },
  ];
  const correct = flags.filter((f) => f.driver === 'D1');
  const buggyOldFilter = correct.filter((f) => !f.node && !f.link);
  assert.equal(severityOf(correct), 'MISMATCH');
  assert.equal(severityOf(buggyOldFilter), null); // the bug: mismatches vanish
});

test('zoneControlGroups + cgColor: distinct groups get evenly-spaced, distinguishable hues', () => {
  const model = { links: [
    { zone: 'Z', controlGroup: 'A' }, { zone: 'Z', controlGroup: 'B' }, { zone: 'Z', controlGroup: 'C' },
    { zone: 'OTHER', controlGroup: 'D' },
  ] };
  const groups = zoneControlGroups(model, 'Z');
  assert.deepEqual(groups, ['A', 'B', 'C']);
  const hues = groups.map((g) => cgColor(g, groups).border);
  assert.equal(new Set(hues).size, 3); // all distinct
  assert.deepEqual(cgColor(null, groups), { border: '#94a3b8', bg: '#eef2f7', text: '#64748b' });
});
