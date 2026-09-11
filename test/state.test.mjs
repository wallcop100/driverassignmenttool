// Reducer self-check for the round-2 features (multi-select, redo, revert,
// restore). state.js is pure (no React), so it runs directly under node.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as st from '../src/state.js';
import { cgColor, diffRows, initialState, reducer, severityOf, zoneControlGroups } from '../src/state.js';

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

// ---- embed mode ----

test('INIT carries the host view and context; RESTORE keeps the context', () => {
  const view = { page: 'zone', zone: 'HUB-B1' };
  const context = { systemSetId: 108835, hubRef: 'p50123', hubLabel: 'HUB-B1' };
  const s = reducer(initialState, { type: 'INIT', model, view, context });
  assert.deepEqual(s.view, view);         // embedded opens straight on focusZone
  assert.deepEqual(s.context, context);
  // a resume must not blank out which hub/set the host said we are looking at
  const r = reducer(s, { type: 'RESTORE', saved: { model, assignments: {}, view } });
  assert.deepEqual(r.context, context);
});

test('INIT without a view falls back to the landing page (standalone unchanged)', () => {
  const s = reducer(initialState, { type: 'INIT', model });
  assert.deepEqual(s.view, { page: 'landing' });
  assert.equal(s.context, null);
});

test('diffRows counts changed nodes — the number reported to the host as dat:dirty', () => {
  let s = init();
  assert.equal(diffRows(s).length, 0);                 // baseline is not dirty
  s = reducer(s, { type: 'MOVE_MANY', linkRefs: ['X1'], toKey: 'D|OP.2' });
  assert.equal(diffRows(s).length, 2);                 // moved out of one node, into another
  s = reducer(s, { type: 'UNDO' });
  assert.equal(diffRows(s).length, 0);
});

test('RESTORE pins the view when told to — an embedded resume must not leave the hub', () => {
  const here = { page: 'zone', zone: 'HUB-B1' };
  const elsewhere = { page: 'zone', zone: 'HUB-D' };
  const s = reducer(initialState, { type: 'INIT', model, view: here });
  // the saved session was left on a different screen; embedded we ignore that
  const saved = { model, assignments: {}, view: elsewhere };
  assert.deepEqual(reducer(s, { type: 'RESTORE', saved, view: here }).view, here);
  // standalone (no pin) still follows the saved view
  assert.deepEqual(reducer(s, { type: 'RESTORE', saved }).view, elsewhere);
});

test('the review lists cables, not driver nodes — the shape LinksMap is patched in', () => {
  const model = {
    baseline: {
      'D1|OP.1': { toEntityType: 'Link', refs: ['L1', 'L2'] },
      'D2|OP.1': { toEntityType: 'Link', refs: [] },
    },
    drivers: [], links: [],
  };
  const state = {
    model,
    assignments: {
      'D1|OP.1': { toEntityType: 'Link', refs: ['L1'] },
      'D2|OP.1': { toEntityType: 'Link', refs: ['L2'] },
    },
    addedDrivers: [], presets: {},
  };
  // one cable moved — one row, naming where it was and where it is
  assert.deepEqual(st.linkDiffRows(state), [
    { ref: 'L2', from: 'D1|OP.1', to: 'D2|OP.1', isNew: false },
  ]);
  // the node view of the same change is two rows, which is why it read oddly
  assert.equal(st.diffRows(state).length, 2);
});

test('a cable returned to the tray reads as a move to nothing', () => {
  const model = { baseline: { 'D1|OP.1': { toEntityType: 'Link', refs: ['L1'] } }, drivers: [], links: [] };
  const state = {
    model,
    assignments: { 'D1|OP.1': { toEntityType: 'Link', refs: [] } },
    addedDrivers: [], presets: {},
  };
  assert.deepEqual(st.linkDiffRows(state), [{ ref: 'L1', from: 'D1|OP.1', to: null, isNew: false }]);
});

test('a corrected driver type counts as a change the host should hear about', () => {
  const model = { baseline: { 'D1|OP.1': { toEntityType: 'Link', refs: ['L1'] } }, drivers: [], links: [] };
  const clean = {
    model,
    assignments: { 'D1|OP.1': { toEntityType: 'Link', refs: ['L1'] } },
    addedDrivers: [], presets: {},
  };
  assert.equal(st.changeCount(clean), 0);
  // nothing moved, but a type was rewritten — the patch has work to do
  const edited = { ...clean, presets: { 'ET-X': { typeRef: 'ET-X', maxPowerW: 30 } } };
  assert.equal(st.linkDiffRows(edited).length, 0);
  assert.equal(st.changeCount(edited), 1);
});

test('removing an added driver forgets it; removing a real one marks it deleted', () => {
  const base = {
    ...initialState,
    model: {
      baseline: { 'D1|OP.1': { toEntityType: 'Link', refs: ['L1'] } },
      drivers: [{ ref: 'D1', typeRef: 'T', zone: 'Z', nodes: [{ name: 'OP.1' }] }],
      links: [], inventory: [{ typeRef: 'T', nodes: [{ name: 'OP.1' }] }],
    },
    assignments: {
      'D1|OP.1': { toEntityType: 'Link', refs: ['L1'] },
      'E5000X|OP.1': { toEntityType: 'Link', refs: ['L2'] },
    },
    addedDrivers: [{ ref: 'E5000X', typeRef: 'T', zone: 'Z' }],
  };

  // added here, so it never reached the workbook — nothing to delete
  const gone = reducer(base, { type: 'REMOVE_DRIVER', ref: 'E5000X' });
  assert.deepEqual(gone.addedDrivers, []);
  assert.deepEqual(gone.deletedDrivers, []);
  assert.ok(!('E5000X|OP.1' in gone.assignments), 'its cables go back to the tray');

  // really in the design: the row gets marked, not removed
  const del = reducer(base, { type: 'REMOVE_DRIVER', ref: 'D1' });
  assert.deepEqual(del.deletedDrivers, ['D1']);
  assert.ok(!('D1|OP.1' in del.assignments));
  assert.deepEqual(st.effectiveDrivers(del.model, del.addedDrivers, del.deletedDrivers)
    .map((d) => d.ref), ['E5000X'], 'a deleted driver stops being one of the hub’s');

  // and it can be taken back
  const back = reducer(del, { type: 'RESTORE_DRIVER', ref: 'D1' });
  assert.deepEqual(back.deletedDrivers, []);
  assert.ok('D1|OP.1' in back.assignments);
});

test('correcting a banned node name renames it and keeps every cable on it', () => {
  const model = {
    inventory: [{ typeRef: 'T-DT8', powerType: 'CV', maxPowerW: 185, outputVoltageV: 24,
      ballast: 1, nodes: [{ name: 'OP.1:2', maxFvV: null, maxLoadW: null }] }],
    drivers: [{ ref: 'E1', zone: 'Z', typeRef: 'T-DT8', nodes: [{ name: 'OP.1:2' }] }],
    baseline: { 'E1|OP.1:2': { toEntityType: 'Link', refs: ['X1', 'X2'] } },
    links: [],
  };
  const base = {
    ...initialState,
    model,
    assignments: { 'E1|OP.1:2': { toEntityType: 'Link', refs: ['X1', 'X2'] } },
  };
  const fixed = reducer(base, {
    type: 'FIX_NODE_SYNTAX',
    types: [{ typeRef: 'T-DT8', nodeNames: ['OP.1-2'] }],
  });
  // the key is re-spelled and the cables come with it — a rename, not a move
  assert.ok(!('E1|OP.1:2' in fixed.assignments));
  assert.deepEqual(fixed.assignments['E1|OP.1-2'].refs, ['X1', 'X2']);
  // one node still, and every rating left exactly as the DesignDB has it
  assert.deepEqual(fixed.presets['T-DT8'].nodeNames, ['OP.1-2']);
  assert.equal(fixed.presets['T-DT8'].outputs, 1);
  assert.equal(fixed.presets['T-DT8'].maxPowerW, 185);
  assert.equal(fixed.presets['T-DT8'].addresses, 1);
  // and the patch is told to sweep LinksMap
  assert.equal(fixed.fixNodeSyntax, true);
});
