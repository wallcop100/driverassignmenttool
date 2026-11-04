import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { PARTS, combine, resolveSpec, setSharedParts } from '../src/catalogue.js';
import { identify, familyPreset } from '../src/typeFaults.js';
import { observation, ownValues, productName, reasonsFor, send, vote, votesFor } from '../src/learn.js';
import { resetCompanion } from '../src/companion.js';

afterEach(() => { setSharedParts([]); resetCompanion(); delete globalThis.fetch; });

const one = { yes: 1, no: 0, origins: 1, openNo: false, verdict: null };
const mp32 = { name: 'TCI MP 32 HV K2', powerType: 'CC', maxPowerW: 32, minA: 0.35, maxA: 0.7, maxFvV: 46, rev: 'r1', votes: one,
  windows: [{ a: 0.35, w: 19, fv: 54 }, { a: 0.7, w: 32, fv: 46 }] };
const t = (typeRef, name, extra = {}) => ({ typeRef, name, nodes: [{ name: 'OP.1' }], ...extra });

test('a part only one other person sent forms a family, and a yes is the second vote', () => {
  setSharedParts([mp32]);
  const { families } = identify([t('ET-CCR-S-350-1CH-01', 'TCI MP 32 HV K2 - 350mA'), t('ET-CCR-S-700-1CH-01', 'TCI MP 32 HV K2 - 700mA')], resolveSpec);
  assert.equal(families.length, 1);
  const [f] = families;
  assert.deepEqual(f.types.map((x) => x.preset.maxPowerW), [19, 32], 'rated per current');
  assert.deepEqual(votesFor([f.part, f.supply], 'confirmed', {}), [{ name: mp32.name, rev: 'r1', vote: 'confirmed' }]);
  assert.deepEqual(votesFor([f.part], 'confirmed', { r1: 'confirmed' }), [], 'once per version');
});

test('no vote on a datasheet part, your own part, or a confirmed row', () => {
  setSharedParts([{ ...mp32, own: true }, { ...mp32, name: 'Acme Drive 100', rev: 'r2', tier: 'confirmed' }]);
  const [p, c] = ['TCI MP 32 HV K2', 'Acme Drive 100'].map((n) => resolveSpec(n));
  assert.deepEqual(votesFor([PARTS[0], p, c, null], 'confirmed', {}), []);
});

test('its own values: a reason code per value, and the part amended only where the datasheet is wrong', () => {
  const solo = PARTS.find((p) => p.name === 'EldoLED SoloDrive 360/A');
  const ty = t('ET-CCR-D-500-1CH-01', 'EldoLED SoloDrive 360/A 500mA', { powerType: 'CC', maxPowerW: 25, controlType: 'DMX', currentA: 0.5 });
  const preset = familyPreset(ty, solo, 0.5);
  assert.deepEqual(reasonsFor({ was: 25, now: 30 }), ['derated', 'variant', 'datasheet']);
  assert.deepEqual(reasonsFor({ was: 185, now: 30 }), ['variant', 'datasheet'], 'derated only when lower');

  const [kept] = ownValues(ty, preset, solo, { maxPowerW: 'derated', controlType: 'variant' });
  assert.deepEqual(kept, { reason: { name: solo.name, values: { maxPowerW: 'derated', controlType: 'variant' } } }, 'no part sent');

  const [fixed] = ownValues(ty, preset, solo, { maxPowerW: 'datasheet', controlType: 'variant' });
  assert.equal(fixed.part.name, solo.name);
  assert.equal(fixed.part.maxPowerW, 25);
  assert.equal(fixed.part.controlType, 'DALI', 'a variant is not written into the part');
  assert.equal(fixed.part.sizeMm.length, 3, 'the rest of the datasheet goes with it');
  assert.equal(solo.maxPowerW, 30, 'the catalogue is untouched');
  assert.equal(fixed.part.re, undefined);

  // an earlier amendment is built on only once it is agreed: unchecked, it is not this person's word
  const only = { controlType: 'datasheet' };
  setSharedParts([{ name: solo.name, powerType: 'CC', maxPowerW: 36, rev: 'a1', votes: one }]);
  assert.equal(ownValues(ty, preset, solo, only)[0].part.maxPowerW, 30);
  setSharedParts([{ name: solo.name, powerType: 'CC', maxPowerW: 36, rev: 'a1', votes: { ...one, yes: 2, origins: 2 } }]);
  assert.equal(ownValues(ty, preset, solo, only)[0].part.maxPowerW, 36);
});

test('its own values on a pair: the supply owns the rail, and the watts when it is the smaller', () => {
  const lin = PARTS.find((p) => p.kind === 'dcdc' && p.nodeCurrentA == null);
  const psu = { name: 'Meanwell HLG-100-24', kind: 'supply', powerType: 'CV', maxPowerW: 20, outputV: 24, outputs: 1, controlType: 'Local' };
  const spec = combine(lin, psu);
  const ty = t('ET-CVR-1', `${lin.name} & HLG-100-24`, { powerType: 'CV', maxPowerW: 18, outputVoltageV: 12 });
  const out = ownValues(ty, familyPreset(ty, spec, null), spec, { maxPowerW: 'datasheet', outputVoltageV: 'datasheet' });
  assert.deepEqual(out.map((b) => b.part.name), [psu.name]);
  assert.deepEqual([out[0].part.maxPowerW, out[0].part.outputV], [18, 12]);
});

test('a part rated per current is amended at the current the type runs at', () => {
  // a datasheet part: a shared one only fills blanks, so its values never differ
  const spec = { ...mp32, aliases: ['tcimp32hvk2'] };
  const ty = t('ET-CCR-S-350-1CH-01', 'TCI MP 32 HV K2 - 350mA', { powerType: 'CC', currentA: 0.35, maxPowerW: 17 });
  const [b] = ownValues(ty, familyPreset(ty, spec, 0.35), spec, { maxPowerW: 'datasheet' });
  assert.deepEqual(b.part.windows, [{ a: 0.35, w: 17, fv: 54 }, { a: 0.7, w: 32, fv: 46 }]);
  assert.equal(b.part.aliases.length, 0, 'its own name is not sent back as an alias');
});

test('filled in by hand: the product, its currents as the range, and watts per current', () => {
  assert.equal(productName('TCI MP 32 HV K2 - 350mA'), 'TCI MP 32 HV K2');
  assert.equal(productName('LIN 200D-D2Z2C LightShape Variant 3'), 'LIN 200D-D2Z2C LightShape');
  const p = (currentA, maxPowerW) => ({ typeRef: 'x', powerType: 'CC', currentA, maxPowerW, outputs: 1, addresses: 1, nodeMaxFvV: 50, controlType: 'DALI' });
  const o = observation('Acme Widget 40 - 350mA', [p(0.35, 19), p(0.7, 32)]);
  assert.deepEqual([o.name, o.kind, o.minA, o.maxA, o.maxPowerW, o.maxFvV], ['Acme Widget 40', 'driver', 0.35, 0.7, 32, 50]);
  assert.deepEqual(o.windows, [{ a: 0.35, w: 19 }, { a: 0.7, w: 32 }]);
  assert.equal(Object.values(o).includes(null), false);
  const single = observation('Acme Widget 40 - 350mA', [p(0.35, 19)]);
  assert.equal(single.minA, undefined, 'one current says nothing about the range');
  assert.equal(observation('LED Driver', [p(0.35, 19)]), null, 'no model number: it would match too much');
  assert.equal(observation('EldoLED SoloDrive 360/A 500mA', [p(0.5, 30)]), null, 'a known part is not sent again');
});

test('sends go to companion/parts, update the shared set, and are remembered; Pages sends nothing', async () => {
  globalThis.window = { location: { href: 'https://h/' } };
  globalThis.fetch = async () => { throw new Error('no network on Pages'); };
  await vote([{ ...mp32, shared: 'observed' }], 'confirmed');
  await send([{ reason: { name: 'x', values: {} } }]);
  resetCompanion();

  const calls = [];
  const reply = (body) => ({ ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body });
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('capabilities')) return reply({ protocol: 'dat-companion/1', features: ['parts'] });
    calls.push(JSON.parse(init.body));
    return reply({ parts: [{ ...mp32, votes: { ...one, yes: 2, origins: 2 } }] });
  };
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  try {
    setSharedParts([mp32]);
    await vote([resolveSpec('TCI MP 32 HV K2')], 'confirmed');
    assert.deepEqual(calls, [{ vote: { name: mp32.name, rev: 'r1', vote: 'confirmed' } }]);
    assert.equal(resolveSpec('TCI MP 32 HV K2').votes.yes, 2, 'the answer is the new shared set');
    await vote([resolveSpec('TCI MP 32 HV K2')], 'rejected');
    assert.equal(calls.length, 1, 'one vote per version, the first answer standing');
    await send([{ reason: { name: mp32.name, values: { maxPowerW: 'derated' } } }, null]);
    assert.deepEqual(calls[1], { reason: { name: mp32.name, values: { maxPowerW: 'derated' } } });
  } finally {
    delete globalThis.window;
    delete globalThis.localStorage;
  }
});
