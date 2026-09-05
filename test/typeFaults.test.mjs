// The judgement a driver type gets, and what the one-click fixes propose. Pure
// module, so this runs under plain `node --test` with no DOM.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveSpec } from '../src/engine.js';
import {
  canFill, canReplace, currentOptions, faults, fixPreset, ratingsOf,
} from '../src/typeFaults.js';

const SOLO = resolveSpec('EldoLED SOLODrive 360/A at 1050mA');

// as buildModel leaves an ElementType
const type = (over = {}) => ({
  typeRef: 'ET-CCR-D-1050-1CH-01',
  name: 'EldoLED SOLODrive 360/A at 1050mA',
  powerType: 'CC', maxPowerW: 185, currentA: 1.05, ballast: 1, controlType: 'DALI',
  nodes: [{ name: 'OP.1', maxFvV: null, maxLoadW: null }],
  ...over,
});

test('a type stating nothing is flagged for it', () => {
  const f = faults(type({ maxPowerW: null, powerType: null, currentA: null }), SOLO);
  assert.match(f[0][0], /no MaxPower/);
  assert.match(f[1][0], /no CC\/CV/);
});

test('a wattage the spec page disagrees with is attributed, not asserted', () => {
  const [[short, full]] = faults(type(), SOLO);
  assert.match(short, /185W here · spec page says 30W/);
  assert.match(full, /the name is what matched it/);   // the match can be wrong
  assert.equal(faults(type({ maxPowerW: 30 }), SOLO).length, 0);
});

test('a preset is a proposal, so the DesignDB row is what gets judged', () => {
  const t = { ...type({ maxPowerW: 30 }), designDB: type() };
  assert.equal(faults(t, SOLO).length, 1, 'still flags the 185W underneath');
});

test('fill adds only what is missing; replace overwrites what disagrees', () => {
  const t = type({ nodes: [{ name: 'OP.1', maxFvV: null, maxLoadW: null }] });
  const filled = fixPreset(t, SOLO, 'fill');
  assert.equal(filled.maxPowerW, 185, 'a stated value survives a fill');
  assert.equal(filled.nodeMaxFvV, SOLO.maxFvV, 'the blank is filled');
  assert.equal(fixPreset(t, SOLO, 'replace').maxPowerW, 30);
});

test('the fixes are offered only when they would do something', () => {
  assert.equal(canReplace(type(), SOLO), true);
  assert.equal(canReplace(type({ maxPowerW: 30 }), SOLO), false);
  assert.equal(canFill(type({ nodes: [{ maxFvV: 55 }] }), SOLO), false);
  assert.equal(canFill(type({ currentA: null }), SOLO), true);
});

test('the current comes from the ref and the name, and out-of-range is refused', () => {
  // both say 1050mA
  assert.deepEqual(currentOptions(type(), SOLO), [{ a: 1.05, from: 'ref' }]);
  // the name says something else and both are in range: neither wins outright
  const split = currentOptions(type({ name: 'EldoLED SOLODrive 360/A at 350mA' }), SOLO);
  assert.deepEqual(split, [{ a: 1.05, from: 'ref' }, { a: 0.35, from: 'name' }]);
  // 9A is outside 0.15–1.4A, so it is not offered at all
  const wild = currentOptions(type({ typeRef: 'ET-CCR-D-9000-1CH-01' }), SOLO);
  assert.deepEqual(wild.map((o) => o.from), ['name']);
});

test('choosing a current corrects the Name and never the Ref', () => {
  const t = type({ name: 'EldoLED SOLODrive 360/A at 350mA' });
  const p = fixPreset(t, SOLO, 'fill', 1.05);
  assert.equal(p.typeRef, 'ET-CCR-D-1050-1CH-01', 'the Ref is what Elements point at');
  assert.equal(p.name, 'EldoLED SOLODrive 360/A at 1050mA');
});

test('ratingsOf reads the side of the type it is given', () => {
  assert.equal(ratingsOf(type()), '185W · 1.05A');
  assert.equal(ratingsOf({ maxPowerW: 180, outputVoltageV: 24, nodeMaxFvV: 55 }), '180W · 24V · 55fV/out');
});
