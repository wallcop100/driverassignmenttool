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
