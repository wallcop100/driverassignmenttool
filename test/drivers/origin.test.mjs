// A value the tool supplied has to say where it came from, or a datasheet
// figure reads as the design's own.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fillFromSpec, fixPreset } from '../../src/typeFaults.js';
import { presetToType, resolveSpec } from '../../src/engine.js';

const t = { typeRef: 'ET-CCR-D-350-1CH-01', name: 'EldoLED SoloDrive 360/A', nodes: [{ name: 'OP.1' }] };

test('a preset filled from the datasheet is marked datasheet, not edited', () => {
  const spec = resolveSpec(t.name);
  assert.equal(fillFromSpec({ t, spec, currentA: 0.35 }).origin, 'datasheet');
  assert.equal(fixPreset(t, spec, 'fill', 0.35).origin, 'datasheet');
  assert.equal(presetToType(fillFromSpec({ t, spec, currentA: 0.35 })).origin, 'datasheet');
});

test('a preset with no origin was typed by somebody', () => {
  assert.equal(presetToType({ typeRef: 'X', powerType: 'CC', maxPowerW: 30, currentA: 0.35 }).origin, 'edited');
});

test('a size and a TBC flag set here are kept, and a null takes them back off', async () => {
  const { reducer, initialState } = await import('../../src/state.js');
  let st = reducer(initialState, { type: 'SET_TYPE_SIZE', typeRef: 'ET-A', size: [153, 50, 23] });
  assert.deepEqual(st.typeSizes, { 'ET-A': { size: [153, 50, 23] } });
  st = reducer(st, { type: 'SET_TYPE_SIZE', typeRef: 'ET-A', size: null });
  assert.deepEqual(st.typeSizes, {});
  st = reducer(st, { type: 'SET_TBC', ref: 'E1', flags: { sheet: 'E', isTBC: true, isPropertiesTBC: false } });
  assert.equal(st.tbc.E1.isTBC, true);
  assert.deepEqual(reducer(st, { type: 'SET_TBC', ref: 'E1', flags: null }).tbc, {});
});

test('a quantity broken apart adds the rest as placeholder drivers, and only once', async () => {
  const { reducer, initialState } = await import('../../src/state.js');
  const model = { drivers: [{ ref: 'E50028', typeRef: 'T', zone: 'HUB-B2', nodes: [{ name: 'OP.1' }] }],
    inventory: [{ typeRef: 'T', nodes: [{ name: 'OP.1' }, { name: 'OP.2' }] }], links: [], baseline: {} };
  let st = { ...initialState, model };
  st = reducer(st, { type: 'SPLIT_QUANTITY', ref: 'E50028', typeRef: 'T', zone: 'HUB-B2', quantity: 4 });
  assert.equal(st.addedDrivers.length, 3);
  assert.ok(st.addedDrivers.every((d) => d.split === 'E50028' && d.zone === 'HUB-B2'));
  assert.deepEqual(st.assignments[`${st.addedDrivers[0].ref}|OP.2`], { toEntityType: '', refs: [] });
  assert.equal(reducer(st, { type: 'SPLIT_QUANTITY', ref: 'E50028', typeRef: 'T', zone: 'HUB-B2', quantity: 4 }), st, 'not twice');
  assert.equal(reducer(st, { type: 'UNDO' }).addedDrivers.length, 0, 'and undo puts the stack back');
});

test('Elements in the hub that the form never mentioned become drivers, never added ones', async () => {
  const { hubElements } = await import('../../src/state.js');
  const model = { inventory: [{ typeRef: 'ET-CCR-D-350-1CH-01', name: 'SOLODrive', powerType: 'CC', nodes: [{ name: 'OP.1' }] }] };
  const rows = { elements: {
    E50004: { ref: 'E50004', typeRef: 'ET-CCR-D-350-1CH-01', name: '', quantity: 4 },
    E50027: { ref: 'E50027', typeRef: 'ET-PEN-PROV', name: 'Pendant provision', quantity: 3 },
    E1: { ref: 'E1', typeRef: 'ET-CCR-D-350-1CH-01', name: '', quantity: 1 },
    E2: { ref: 'E2', typeRef: null, name: '', quantity: 1 },
  } };
  const out = hubElements(model, [{ ref: 'E1' }], rows, 'P50001');
  assert.deepEqual(out.map((d) => d.ref), ['E50004', 'E50027'], 'not one the form already has, nor a row with no type');
  assert.equal(out[0].powerType, 'CC', 'built from the type library');
  assert.equal(out[1].name, 'Pendant provision');
  assert.ok(out.every((d) => d.fromDb && !d.added && d.zone === 'P50001'));
});
