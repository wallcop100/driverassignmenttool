// Node self-check for the ported engine (npm test). Mirrors the key assertions
// from the former Python pytest suite, run against the sample CSVs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import * as engine from '../src/engine.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'sample-data');
const pick = (pat) => fs.readdirSync(dir).find((f) => f.includes(pat));
const hasSamples = fs.existsSync(dir) && pick('DJ101580') && pick('DJ101585');

const load = () => engine.buildModel(
  fs.readFileSync(path.join(dir, pick('DJ101580')), 'utf-8'),
  fs.readFileSync(path.join(dir, pick('DJ101585')), 'utf-8'),
);
const clone = (b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, { ...v, refs: [...v.refs] }]));

test('parse shapes', { skip: !hasSamples && 'sample-data absent' }, () => {
  const m = load();
  assert.equal(m.zones.length, 11);
  assert.equal(m.links.length, 212);
  const e = m.drivers.find((d) => d.ref === 'E50019');
  assert.equal(e.powerType, 'CC');
  assert.equal(e.maxPowerW, 50);
  assert.equal(e.currentA, 0.3);
  assert.deepEqual(e.nodes.map((n) => n.maxFvV), [55, 55]);
  assert.ok(m.drivers.some((d) => d.undetermined));
});

test('baseline has no FAILs', { skip: !hasSamples && 'sample-data absent' }, () => {
  const m = load();
  const fails = engine.validate(m, clone(m.baseline), []).filter((f) => f.level === 'FAIL');
  assert.deepEqual(fails, []);
});

test('overfill fails', { skip: !hasSamples && 'sample-data absent' }, () => {
  const m = load();
  const a = clone(m.baseline);
  const cc = m.links.filter((l) => l.zone === 'HUB-A' && l.powerType === 'CC').map((l) => l.ref);
  a['E50019|OP.1'] = { toEntityType: 'Link', refs: cc };
  const flags = engine.validate(m, a, []);
  assert.ok(flags.some((f) => f.check === 'TotalWattage' && f.level === 'FAIL' && f.driver === 'E50019'));
});

test('type mismatch flagged', { skip: !hasSamples && 'sample-data absent' }, () => {
  const m = load();
  const a = clone(m.baseline);
  const cv = m.links.find((l) => l.powerType === 'CV').ref;
  a['E50019|OP.1'] = { toEntityType: 'Link', refs: [cv] };
  assert.ok(engine.validate(m, a, []).some((f) => f.check === 'TypeMatch' && f.level === 'MISMATCH' && f.link === cv));
});

test('node restriction parsing', () => {
  assert.deepEqual(engine.parseNodeRestrictions('25W | 55fV'), { maxLoadW: 25, maxFvV: 55 });
  assert.deepEqual(engine.parseNodeRestrictions('55fV'), { maxLoadW: null, maxFvV: 55 });
  assert.deepEqual(engine.parseNodeRestrictions('25W'), { maxLoadW: 25, maxFvV: null });
  assert.deepEqual(engine.parseNodeRestrictions(''), { maxLoadW: null, maxFvV: null });
});

test('fingerprint rules out wrong type', { skip: !hasSamples && 'sample-data absent' }, () => {
  const m = load();
  const cc = m.links.find((l) => l.powerType === 'CC');
  const cv = m.drivers.find((d) => d.powerType === 'CV');
  const ccd = m.drivers.find((d) => d.powerType === 'CC');
  assert.equal(engine.fingerprintCompatible(cc, cv), false);
  assert.equal(engine.fingerprintCompatible(cc, ccd), true);
});

test('eligibility shape', { skip: !hasSamples && 'sample-data absent' }, () => {
  const m = load();
  const e = engine.eligibility(m, 'HUB-A', clone(m.baseline), []);
  const zoneLinks = m.links.filter((l) => l.zone === 'HUB-A').map((l) => l.ref).sort();
  assert.deepEqual(Object.keys(e.nodesByLink).sort(), zoneLinks);
  const cc = m.links.find((l) => l.zone === 'HUB-A' && l.powerType === 'CC');
  const cvInZone = m.drivers.filter((d) => d.zone === 'HUB-A' && d.powerType === 'CV').map((d) => d.ref);
  assert.ok(cvInZone.every((r) => e.impossibleByLink[cc.ref].includes(r)));
});

test('export roundtrip lossless', { skip: !hasSamples && 'sample-data absent' }, () => {
  const m = load();
  const csv = engine.exportCsv(m, clone(m.baseline), []);
  const linksText = fs.readFileSync(path.join(dir, pick('DJ101585')), 'utf-8');
  const m2 = engine.buildModel(csv, linksText);
  assert.deepEqual(m2.baseline, m.baseline);
  assert.deepEqual(m2.drivers.map((d) => d.ref), m.drivers.map((d) => d.ref));
});

test('export reflects a move + added driver', { skip: !hasSamples && 'sample-data absent' }, () => {
  const m = load();
  const a = clone(m.baseline);
  const added = [{ ref: 'E90001', typeRef: 'ET-CCR-D-300-2CH-01', zone: 'HUB-A' }];
  const link = m.links.find((l) => l.powerType === 'CC' && l.zone === 'HUB-A').ref;
  for (const [k, v] of Object.entries(a)) if (v.refs.includes(link)) a[k] = { ...v, refs: v.refs.filter((r) => r !== link) };
  a['E90001|OP.1'] = { toEntityType: 'Link', refs: [link] };
  const csv = engine.exportCsv(m, a, added);
  assert.ok(csv.includes('"E90001"'));
  assert.ok(engine.validate(m, a, added).every((f) => !(f.level === 'FAIL' && f.driver === 'E90001')));
});

test('malformed csv rejected', () => {
  assert.throws(() => engine.buildModel('Foo,Bar\r\n1,2\r\n', 'Foo,Bar\r\n1,2\r\n'), /missing column/);
});

test('detectKind identifies each file by header', { skip: !hasSamples && 'sample-data absent' }, () => {
  const form = fs.readFileSync(path.join(dir, pick('DJ101580')), 'utf-8');
  const links = fs.readFileSync(path.join(dir, pick('DJ101585')), 'utf-8');
  assert.equal(engine.detectKind(form), 'form');
  assert.equal(engine.detectKind(links), 'links');
  assert.equal(engine.detectKind('A,B\r\n1,2\r\n'), null);
});

test('backwards compatible: extra columns ok, only signature required', () => {
  // future columns present, plus only essential form columns — must still parse
  const form = 'ElementRef,Node,ToEntityRefs,FutureCol\r\n"E1","OP.1","","x"\r\n';
  const links = 'LinkRef,PullZone,Whatever\r\n"X1","Z","y"\r\n';
  const m = engine.buildModel(form, links);
  assert.equal(m.drivers[0].ref, 'E1');
  assert.equal(m.drivers[0].undetermined, true); // no Driver Restrictions column
  assert.equal(m.links[0].ref, 'X1');
});

test('CC cable without current data produces no CurrentMatch warning', { skip: !hasSamples && 'sample-data absent' }, () => {
  const m = load();
  const a = clone(m.baseline);
  // E50019 is a CC driver; the sample CC links carry no current — expect no CurrentMatch flag
  const flags = engine.validate(m, a, []).filter((f) => f.check === 'CurrentMatch' && f.driver === 'E50019');
  assert.deepEqual(flags, []);
});

test('distributeGroup spreads capacity-aware and reports overflow', { skip: !hasSamples && 'sample-data absent' }, () => {
  const m = load();
  const a = clone(m.baseline);
  // pick a CC 2CH driver (E50019, 50W total, two 55fV nodes) and empty it
  for (const k of ['E50019|OP.1', 'E50019|OP.2']) a[k] = { toEntityType: '', refs: [] };
  // grab several CC HUB-A cables (each ~11.8W); spread across the two nodes
  const cc = m.links.filter((l) => l.zone === 'HUB-A' && l.powerType === 'CC').slice(0, 6).map((l) => l.ref);
  const { placements, unplaced } = engine.distributeGroup(m, a, [], cc, ['E50019|OP.1', 'E50019|OP.2']);
  const linkOf = (r) => m.links.find((l) => l.ref === r);
  const placed = Object.values(placements).flat();
  assert.equal(placed.length + unplaced.length, cc.length);
  // capacity respected: no node exceeds its 55fV limit and the driver stays ≤ 50W
  for (const [key, refs] of Object.entries(placements)) {
    const fv = refs.reduce((s, r) => s + (linkOf(r).fvV ?? 0), 0);
    assert.ok(fv <= 55, `node ${key} fV ${fv}`);
  }
  assert.ok(placed.reduce((s, r) => s + (linkOf(r).loadW ?? 0), 0) <= 50);
  // capacity genuinely binds here (35fV cables, 55fV nodes) — some placed, some overflow
  assert.ok(placed.length > 0 && unplaced.length > 0, `placed ${placed.length}, unplaced ${unplaced.length}`);
});

test('distributeGroup spreads evenly across roomy nodes', () => {
  // synthetic model with generous caps so evenness (not capacity) is what's tested
  const model = {
    zones: ['Z'], baseline: {}, originalRows: [], fieldnames: [], inventory: [],
    links: [1, 2, 3, 4].map((i) => ({ ref: `C${i}`, zone: 'Z', powerType: 'CC', currentA: 0.3, loadW: 10, fvV: 5, controlGroup: 'G' })),
    drivers: [{ ref: 'D', zone: 'Z', powerType: 'CC', currentA: 0.3, maxPowerW: 1000, outputVoltageV: null, undetermined: false,
      nodes: [{ name: 'OP.1', maxFvV: 1000, maxLoadW: null }, { name: 'OP.2', maxFvV: 1000, maxLoadW: null }] }],
  };
  const { placements, unplaced } = engine.distributeGroup(model, {}, [], ['C1', 'C2', 'C3', 'C4'], ['D|OP.1', 'D|OP.2']);
  assert.deepEqual(unplaced, []);
  assert.equal(placements['D|OP.1'].length, 2); // even 2 / 2, not 4 / 0
  assert.equal(placements['D|OP.2'].length, 2);
});

test('distributeGroup skips fingerprint-incompatible nodes', { skip: !hasSamples && 'sample-data absent' }, () => {
  const m = load();
  const a = clone(m.baseline);
  const ccLink = m.links.find((l) => l.zone === 'HUB-A' && l.powerType === 'CC').ref;
  const cvNode = m.drivers.filter((d) => d.zone === 'HUB-A' && d.powerType === 'CV')[0];
  const key = `${cvNode.ref}|${cvNode.nodes[0].name}`;
  const { placements, unplaced } = engine.distributeGroup(m, a, [], [ccLink], [key]);
  assert.deepEqual(placements, {}); // CC cable can't go on a CV node
  assert.deepEqual(unplaced, [ccLink]);
});

test('demo dataset opens with HUB-A fully unassigned', () => {
  const demoDir = path.join(dir, '..', 'src', 'demo');
  const m = engine.buildModel(
    fs.readFileSync(path.join(demoDir, 'form.csv'), 'utf-8'),
    fs.readFileSync(path.join(demoDir, 'links.csv'), 'utf-8'),
  );
  const hubaDrivers = m.drivers.filter((d) => d.zone === 'HUB-A');
  assert.ok(hubaDrivers.length > 0, 'HUB-A still has drivers');
  const assignedInHubA = Object.entries(m.baseline)
    .filter(([k]) => hubaDrivers.some((d) => k.startsWith(`${d.ref}|`)))
    .flatMap(([, v]) => v.refs);
  assert.deepEqual(assignedInHubA, [], 'no HUB-A node has assignments');
  assert.ok(m.links.some((l) => l.zone === 'HUB-A'), 'HUB-A links still present (they land in the tray)');
});
