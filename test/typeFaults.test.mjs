// The judgement a driver type gets, and what the one-click fixes propose. Pure
// module, so this runs under plain `node --test` with no DOM.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkOf, resolveSpec, setSharedParts } from '../src/engine.js';
import {
  autoFillable, canFill, canReplace, currentOptions, disagreeing, faults, fixPreset, leaves, ratingsOf,
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

test('a pending fix clears the flags it answers, but not its own blanks', () => {
  const blank = type({ maxPowerW: null, powerType: null, currentA: null });
  assert.equal(faults({ ...type({ maxPowerW: 30 }), preset: true, designDB: blank }, SOLO).length, 0);
  assert.equal(faults({ ...type({ maxPowerW: 100 }), preset: true, designDB: blank }, SOLO).length, 0,
    'a chosen wattage off the spec page is the user\'s answer, not a fault');
  assert.equal(faults({ ...type({ maxPowerW: null }), preset: true, designDB: blank }, SOLO).length, 1);
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

test('a fix is judged by what it would still leave flagged (9GYN2L)', () => {
  const solo = resolveSpec('EldoLED SOLODrive 360/A');
  // no current in the Ref or the Name: the spec page alone leaves CurrentRange blank
  const t = type({ typeRef: 'ET-CCR-D-1CH-02', name: 'EldoLED SOLODrive 360/A', powerType: null, currentA: null });
  assert.match(leaves(t, solo, 'replace')[0][0], /no CurrentRange/);
  assert.deepEqual(leaves(t, solo, 'replace', 0.7), []);
  // a DC/DC driver with no supply: nothing the datasheet has gives it a voltage
  const lin = resolveSpec('EldoLED LinearDrive 220D');
  const cv = { typeRef: 'ET-CVR-01', name: 'EldoLED LinearDrive 220D', powerType: null, maxPowerW: null, nodes: [{ name: 'OP.1' }] };
  assert.match(leaves(cv, lin, 'fill')[0][0], /no OutputVoltage/);
  assert.deepEqual(leaves(type(), SOLO, 'replace'), []);
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

test('a shared part fills blanks, never overwrites, and says where it came from', () => {
  const shared = { ...SOLO, shared: 'observed' };
  assert.match(faults(type(), shared)[0][0], /shared catalogue says 30W/);
  assert.equal(canReplace(type(), shared), false);
  assert.equal(fixPreset(type({ maxPowerW: null }), shared, 'fill').origin, 'shared');
  assert.equal(fixPreset(type(), SOLO, 'fill').origin, 'datasheet');
});

test('a shared part is checked by a second person before it fills anything, and is judged per current', () => {
  const mp32 = {
    name: 'TCI MP 32 HV K2', powerType: 'CC', maxPowerW: 32, minA: 0.35, maxA: 0.7, maxFvV: 46, rev: 'r1',
    windows: [{ a: 0.35, w: 19, fv: 54 }, { a: 0.7, w: 32, fv: 46 }],
  };
  const t = { typeRef: 'ET-CCR-D-350-1CH-01', name: 'TCI MP 32 HV K2 - 350mA', powerType: 'CC', maxPowerW: 19,
    currentA: 0.35, nodes: [{ name: 'OP.1' }] };
  const one = { yes: 1, no: 0, origins: 1, openNo: false, verdict: null };
  try {
    setSharedParts([{ ...mp32, votes: one }]);
    const spec = resolveSpec(t.name);
    assert.equal(checkOf(spec), 'unchecked');
    assert.equal(autoFillable([{ ...t, maxPowerW: null }], resolveSpec).asks[0].why, 'shared part, not yet checked');
    assert.equal(faults(t, spec).length, 0, '19W is right at 350mA, though the headline is 32W');
    assert.equal(fixPreset({ ...t, maxPowerW: null }, spec, 'fill', 0.35).nodeMaxFvV, 54);
    setSharedParts([{ ...mp32, votes: { ...one, yes: 2, origins: 2 } }]);
    assert.equal(checkOf(resolveSpec(t.name)), 'agreed');
    assert.equal(autoFillable([{ ...t, maxPowerW: null }], resolveSpec).ready.length, 1);
    assert.deepEqual(disagreeing([{ ...t, maxPowerW: 40 }], resolveSpec).map((x) => x.typeRef), [t.typeRef]);
    setSharedParts([{ ...mp32, own: true, votes: { ...one, yes: 2, no: 1, origins: 3, openNo: true } }]);
    assert.equal(checkOf(resolveSpec(t.name)), 'unchecked', 'a newer no asks again, even of the sender');
    assert.deepEqual(disagreeing([{ ...t, maxPowerW: 40 }], resolveSpec), [], 'an unchecked part is not evidence');
  } finally {
    setSharedParts([]);
  }
});

test('questions: the Ref answers CC/CV and the current, and the questions narrow to a part', async () => {
  const { known, narrow, nextQuestion, precedent } = await import('../src/typeFaults.js');
  const { allParts } = await import('../src/engine.js');
  const k = known({ typeRef: 'ET-CCR-D-1050-1CH-01', name: '' });
  assert.deepEqual(k.powerType, ['CC', 'Ref']);
  assert.equal(k.currentA[1], 'Ref');
  assert.equal(known({ typeRef: 'X', nodes: [{}] }).outputs, undefined);   // one default OP.1 says nothing

  const parts = allParts();
  assert.equal(nextQuestion(narrow(parts, {}), {}).key, 'powerType');   // always first
  const cc = narrow(parts, { powerType: 'CC' });
  assert.ok(cc.length > 4 && cc.every((p) => p.powerType === 'CC' && p.kind !== 'supply'));
  assert.ok(narrow(parts, { powerType: 'CV' }).some((p) => p.kind === 'supply'));   // a PSU alone can be the driver
  let ans = { powerType: 'CC' };
  for (let q; (q = nextQuestion(narrow(parts, ans), ans));) { const v = Object.keys(q.groups)[0]; ans = { ...ans, [q.key]: q.key === 'outputs' ? Number(v) : v }; }
  assert.ok(narrow(parts, ans).length >= 1 && narrow(parts, ans).length <= 4);
  assert.equal(narrow(parts, { powerType: 'CC', currentA: 99 }).length, 0);   // nothing fits: by hand

  const sug = { name: 'Sent 50', kind: 'driver', powerType: 'CC', shared: 'observed' };   // says no ControlType or outputs
  assert.deepEqual(narrow([sug], { powerType: 'CC', controlType: 'DALI', outputs: 2 }), [sug]);
  assert.equal(nextQuestion([sug, sug, sug, sug, sug], { powerType: 'CC' }), null);   // nothing to split on

  const prec = precedent([{ typeRef: 'A', powerType: 'CC', maxPowerW: 30, name: 'x' }, { typeRef: 'B', name: 'y' }], () => null);
  assert.deepEqual(prec.powerType, { CC: 1 });   // B states nothing, so it is no precedent
});

test('identify: types group by product, and what isn\'t sure goes to the review', async () => {
  const { identify, judge } = await import('../src/typeFaults.js');
  const op = (n) => Array.from({ length: n }, (_, i) => ({ name: `OP.${i + 1}` }));
  // as project 4746 has them: Parameters and BallastCountPerUoM, nothing else
  const t = (typeRef, name, n = 1) => ({ typeRef, name, nodes: op(n), ballast: n });
  const { families, rest } = identify([
    t('ET-DALI-CCR-2CH-350', 'EldoLED DualDrive 560/A 350mA', 2),
    t('ET-DALI-CCR-2CH-700', 'EldoLED DualDrive 560/A 700mA', 2),
    t('ET-DALI-CCR-SC-350', 'EldoLED SOLOdrive 240/A 350mA'),
    t('ET-CCR-D-350-2CH-01', 'EldoLED SOLOdrive 240/A - 350mA', 2),       // a 1-output part, Parameters say 2
    t('ET-DMX-CVR-5CH-01', 'HLG-185H-24A & LTEC LT-995-OLED DMX Decoder', 5),
    t('ET-CCR-S-350-1CH-01', 'TCI MP 32 HV K2 - 350mA'),
    t('ET-CCR-S-700-1CH-01', 'TCI MP 32 HV K2 - 700mA'),
    t('ET-CCR-D-500-1CH-01', ''),                                           // no Name: fits only the SOLOdrive
    t('ET-DALI-CVR-SC-01', 'HLG-185-24A & EldoLED LIN 220D', 2),
    t('DALI-CVR-01', 'EldoLED LINEARDrive 220D'),                         // no supply: takes its sibling's
    t('ET-CVR-FEED-PROV', ''),                                              // no Name, and the Ref gives no outputs
  ], resolveSpec);
  const fam = (name) => families.find((f) => f.part.name === name);
  assert.deepEqual(fam('EldoLED DualDrive 560/A').types.map((x) => x.currentA), [0.35, 0.7]);
  assert.equal(families[0].types.length >= families.at(-1).types.length, true, 'biggest first');
  const solo = fam('EldoLED SoloDrive 240/A');
  assert.equal(solo.types.length, 2);
  assert.match(solo.types[1].note, /a guess/);
  assert.equal(solo.types[1].preset.name, 'EldoLED SOLOdrive 240/A 500mA', 'named like its sibling');
  assert.equal(fam('EldoLED LinearDrive 220D').types.length, 2);
  assert.match(fam('EldoLED LinearDrive 220D').types[1].note, /as the other types here have it/);
  const why = (ref) => rest.find((r) => r.types.some((x) => x.typeRef === ref))?.why;
  assert.match(why('ET-CCR-D-350-2CH-01'), /Parameters give 2 outputs/);
  assert.match(why('ET-DMX-CVR-5CH-01'), /second product/);
  assert.match(why('ET-CVR-FEED-PROV'), /no Name/, 'a feed provision is not guessed into a family');
  assert.equal(rest.find((r) => /TCI/.test(r.types[0].name)).types.length, 2, 'one card for a product no part is known for');

  // the judge: blanks are filled, a value past the part's rating is wrong
  const dual = fam('EldoLED DualDrive 560/A').types[0];
  assert.ok(judge(dual.t, dual.preset, fam('EldoLED DualDrive 560/A').spec).every((j) => j.status === 'fill'));
  const over = { ...type(), designDB: type() };
  const [w] = judge(over, familyPresetOf(over), SOLO);
  assert.equal(w.status, 'wrong');
  assert.match(w.hint, /× what the/);
  assert.equal(judge(type({ maxPowerW: 30, nodes: [{ name: 'OP.1', maxFvV: SOLO.maxFvV }] }),
    familyPresetOf(type()), SOLO).filter((j) => j.status !== 'fill').length, 0, 'agreeing columns are left out');
});

import { familyPreset } from '../src/typeFaults.js';
const familyPresetOf = (t) => familyPreset(t, SOLO, 1.05);
