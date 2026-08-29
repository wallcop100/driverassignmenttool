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

// Synthetic model (no sample-data dependency, so this runs in CI too).
const patchModel = {
  zones: ['Z'], links: [], inventory: [
    { typeRef: 'T', powerType: 'CC', currentA: 0.3, outputVoltageV: null, undetermined: false,
      driverRestrictions: '30W | 0.3A', nodeRestrictions: '55fV', nodes: [{ name: 'OP.1', maxFvV: 55, maxLoadW: null }] },
  ],
  drivers: [{ ref: 'D1', zone: 'Z', typeRef: 'T', powerType: 'CC', currentA: 0.3, maxPowerW: 30, undetermined: false,
    nodes: [{ name: 'OP.1', maxFvV: 55, maxLoadW: null }] }],
  baseline: {
    'D1|OP.1': { toEntityType: 'Link', refs: ['X1'] },
  },
};

test('changedRows: only rows differing from baseline, plus added drivers', () => {
  const a = { 'D1|OP.1': { toEntityType: 'Link', refs: ['X2'] } }; // moved off X1 onto X2
  const rows = engine.changedRows(patchModel, a, []);
  assert.deepEqual(rows, [{ key: 'D1|OP.1', elementRef: 'D1', node: 'OP.1', refs: ['X2'] }]);

  const unchanged = engine.changedRows(patchModel, { 'D1|OP.1': { toEntityType: 'Link', refs: ['X1'] } }, []);
  assert.deepEqual(unchanged, []);
});

test('generatePatchScript: header/footer + one block per ref in changed rows', () => {
  const a = { 'D1|OP.1': { toEntityType: 'Link', refs: ['X1', 'X2'] } }; // X2 newly added
  const script = engine.generatePatchScript(patchModel, a, []);
  assert.match(script, /^\/\/--DB Merge--\/\/\nfunction main\(DB:ExcelScript\.Workbook\) \{/);
  assert.match(script, /\}$/);
  assert.match(script, /LM_FromLinkEndContextType=LinksMap\.getCell\(0,0\)/);
  for (const ref of ['X1', 'X2']) {
    assert.match(script, new RegExp(`getEntireColumn\\(\\)\\.find\\("${ref}"`));
    assert.match(script, new RegExp(`FromLinkEndContextRef\\).setValue\\("D1"\\)`));
    assert.match(script, new RegExp(`FromLinkEndContextParameters\\).setValue\\("\\{OP\\.1\\}"\\)`));
  }
});

test('generatePatchScript: unchanged rows produce no blocks (just header+footer)', () => {
  const script = engine.generatePatchScript(patchModel, clone(patchModel.baseline), []);
  assert.ok(!script.includes('X1'));
  assert.ok(script.trimEnd().endsWith('//Patch\n}'));
});

test('generatePatchScript: added driver rows are patched even with unchanged-looking keys', () => {
  const a = { 'D1|OP.1': { toEntityType: 'Link', refs: ['X1'] }, 'E90001|OP.1': { toEntityType: 'Link', refs: ['X9'] } };
  const script = engine.generatePatchScript(patchModel, a, [{ ref: 'E90001', typeRef: 'T', zone: 'Z' }]);
  assert.ok(!script.includes('"X1"')); // D1|OP.1 unchanged from baseline — not patched
  assert.match(script, /find\("X9"/);
  assert.match(script, /FromLinkEndContextRef\).setValue\("E90001"\)/);
});

test('generatePatchScript escapes quotes in refs', () => {
  const a = { 'D1|OP.1': { toEntityType: 'Link', refs: ['X"1'] } };
  const script = engine.generatePatchScript(patchModel, a, []);
  assert.match(script, /find\("X\\"1"/);
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

test('generatePatchScriptMulti merges hubs into one script', () => {
  const mk = (elementRef, linkRef) => ({
    model: { baseline: { [`${elementRef}|OP.1`]: { refs: [] } } },
    assignments: { [`${elementRef}|OP.1`]: { refs: [linkRef] } },
    addedDrivers: [],
  });
  const a = mk('E1', 'X1');
  const b = mk('E2', 'X2');

  const one = engine.generatePatchScriptMulti([a]);
  const both = engine.generatePatchScriptMulti([a, b]);

  // single-session path is unchanged by the refactor
  assert.equal(one, engine.generatePatchScript(a.model, a.assignments, a.addedDrivers));

  // merged script patches both hubs, with exactly one header/footer
  for (const ref of ['X1', 'X2']) assert.ok(both.includes(`"${ref}"`), `${ref} missing`);
  assert.equal(both.split('//--DB Merge--//').length - 1, 1);
  assert.equal(one.includes('X2'), false);

  assert.equal(engine.generatePatchScriptMulti([]).includes('X1'), false);
});

test('parseDriverRestrictions tolerates spacing and case around the separator', () => {
  // A whitespace difference used to yield powerType:null, which reads as
  // "type undeclared" and makes the driver match nothing in the inventory —
  // surfacing as "N x CV-24V nowhere to go / no matching driver type".
  for (const v of ['180W | 24V', '180W|24V', '180W  |  24V', '180W | 24v', '180W | 24 V', '180 W | 24V']) {
    const r = engine.parseDriverRestrictions(v);
    assert.equal(r.powerType, 'CV', v);
    assert.equal(r.outputVoltageV, 24, v);
    assert.equal(r.maxPowerW, 180, v);
  }
  const cc = engine.parseDriverRestrictions('100w|0.7a');
  assert.equal(cc.powerType, 'CC');
  assert.equal(cc.currentA, 0.7);

  // genuinely different shapes still decline to guess
  for (const v of ['180W', '', '24V | 180W']) {
    assert.equal(engine.parseDriverRestrictions(v).powerType, null, v);
  }
});

// ---- driver type library (dat:types) ----

const TYPES_PER_NODE = `ElementTypeRef,Node,Driver Restrictions,Node Restrictions
ET-CCR-D-300-1CH-01,OP.1,300W | 0.3A,150W | 48fV
ET-CVR-D-24-2CH-01,OP.1,180W | 24V,90W
ET-CVR-D-24-2CH-01,OP.2,180W | 24V,90W
`;
const HUB_FORM = `Pullzone,ElementRef,ElementTypeRef,Driver Restrictions,Node Restrictions,Node,ToEntityType,ToEntityRefs
HUB-C1,E1,ET-CCR-D-300-1CH-01,,,OP.1,,
`;
const HUB_LINKS = `PullZone,LinkRef,LinkTypeRef,LinkSumPower(W),LinkCurrent,LinkVoltage(V),SecondaryPowerType
HUB-C1,X1,CC-SC,11.8,0.3,,CC
`;

test('type library fills blank hub restrictions, joined on ElementTypeRef', () => {
  const bare = engine.buildModel(HUB_FORM, HUB_LINKS);
  assert.equal(bare.drivers[0].powerType, null);      // today: nothing to go on
  assert.equal(bare.drivers[0].undetermined, true);

  const m = engine.buildModel(HUB_FORM, HUB_LINKS, TYPES_PER_NODE);
  const d = m.drivers[0];
  assert.equal(d.powerType, 'CC');
  assert.equal(d.maxPowerW, 300);
  assert.equal(d.currentA, 0.3);
  assert.equal(d.undetermined, false);
  assert.equal(d.nodes[0].maxLoadW, 150);             // node limits join too
  assert.equal(d.nodes[0].maxFvV, 48);
});

test('catalogue offers library types the hub does not contain', () => {
  const m = engine.buildModel(HUB_FORM, HUB_LINKS, TYPES_PER_NODE);
  const refs = m.inventory.map((t) => t.typeRef);
  assert.deepEqual(refs, ['ET-CCR-D-300-1CH-01', 'ET-CVR-D-24-2CH-01']);
  const cv = m.inventory.find((t) => t.typeRef === 'ET-CVR-D-24-2CH-01');
  assert.equal(cv.powerType, 'CV');
  assert.equal(cv.outputVoltageV, 24);
  assert.equal(cv.nodes.length, 2);                   // 2CH from two rows
});

test('a value stated on the hub row wins over the library', () => {
  const overridden = HUB_FORM.replace(',ET-CCR-D-300-1CH-01,,', ',ET-CCR-D-300-1CH-01,100W | 0.1A,');
  const d = engine.buildModel(overridden, HUB_LINKS, TYPES_PER_NODE).drivers[0];
  assert.equal(d.maxPowerW, 100);
  assert.equal(d.currentA, 0.1);
});

test('type library also accepts one row per type with a channel count', () => {
  const flat = `ElementTypeRef,Channels,Driver Restrictions
ET-CVR-D-24-4CH-01,4,320W | 24V
ET-CCR-D-300-1CH-01,,300W | 0.3A
`;
  const inv = engine.parseTypes(flat);
  assert.equal(inv.find((t) => t.typeRef === 'ET-CVR-D-24-4CH-01').nodes.length, 4);
  assert.equal(inv.find((t) => t.typeRef === 'ET-CCR-D-300-1CH-01').nodes.length, 1); // default
  assert.deepEqual(inv[0].nodes.map((n) => n.name), ['OP.1']);
});

test('no library leaves the model byte-identical', () => {
  assert.deepEqual(engine.buildModel(HUB_FORM, HUB_LINKS, ''), engine.buildModel(HUB_FORM, HUB_LINKS));
});

test('library ratings win, but the longer node list survives', () => {
  // a thin library row must not shrink a type the hub demonstrably has 2CH of
  const form = `Pullzone,ElementRef,ElementTypeRef,Driver Restrictions,Node,ToEntityType,ToEntityRefs
HUB-C1,E1,ET-P,,OP.1,,
HUB-C1,E1,ET-P,,OP.2,,
`;
  const thin = 'ElementTypeRef,Node,Driver Restrictions\nET-P,OP.1,180W | 24V\n';
  const t = engine.buildModel(form, HUB_LINKS, thin).inventory.find((x) => x.typeRef === 'ET-P');
  assert.equal(t.nodes.length, 2);        // from the hub rows
  assert.equal(t.powerType, 'CV');        // from the library
  assert.equal(t.maxPowerW, 180);
});

// ---- greenfield: cables, a type library, and no drivers at all ----
const GF_TYPES = 'ElementTypeRef,Driver Restrictions,Node Restrictions,Channels\nT100,100W | 0.35A,100W | 55fV,2\n';
const gfLinks = (n, group = 'CG1', startAt = 1) => [...Array(n)].map((_, i) =>
  `L${startAt + i},HUB-G,20,0.35,10,CC,${group}`).join('\n');
const GF_HEAD = 'LinkRef,PullZone,LinkSumPower(W),LinkCurrent,LinkForwardVoltage(Vf),SecondaryPowerType,ControlGroupText\n';
const gfModel = (linksBody) => engine.buildModel(null, GF_HEAD + linksBody + '\n', GF_TYPES);

test('links-only model: no drivers, library is the inventory, export still works', () => {
  const m = gfModel(gfLinks(2));
  assert.deepEqual(m.drivers, []);
  assert.deepEqual(m.baseline, {});
  assert.deepEqual(m.inventory.map((t) => t.typeRef), ['T100']);
  assert.deepEqual(m.zones, ['HUB-G']);

  const added = [{ ref: 'E5000X', typeRef: 'T100', zone: 'HUB-G' }];
  const a = { 'E5000X|OP.1': { toEntityType: 'Link', refs: ['L1', 'L2'] } };
  const csv = engine.exportCsv(m, a, added);
  assert.match(csv, /^"Pullzone","ParentElementRef","ElementRef"/);
  assert.match(csv, /"E5000X",,"T100"/);   // ElementName blank between them
  assert.match(csv, /"L1,L2"/);
  assert.equal(engine.validate(m, a, added).filter((f) => f.level === 'FAIL').length, 0);
});

test('an empty form CSV is the same as none — the overlay sends a blank block', () => {
  const m = engine.buildModel('', GF_HEAD + gfLinks(2) + '\n', GF_TYPES);
  assert.deepEqual(m.drivers, []);
  assert.deepEqual(m.inventory.map((t) => t.typeRef), ['T100']);
});

test('links-only without a type library is refused', () => {
  assert.throws(() => engine.buildModel(null, GF_HEAD + gfLinks(1) + '\n'), /nothing to build drivers from/);
});

test('planDrivers sizes from load, and the margin costs a driver', () => {
  const m = gfModel(gfLinks(5)); // 5 × 20W = 100W = exactly one 100W/2CH driver
  const tight = engine.planDrivers(m, {}, [], 'HUB-G', { margin: 0 });
  assert.deepEqual(tight.proposals.map((p) => p.count), [1]);
  assert.deepEqual(tight.unplaced, []);

  const roomy = engine.planDrivers(m, {}, [], 'HUB-G', { margin: 0.05 }); // 95W usable
  assert.equal(roomy.drivers.length, 2);
  assert.deepEqual(roomy.unplaced, []);
  assert.deepEqual(roomy.drivers.map((d) => d.ref), ['E5000X', 'E5000X~2']);
  assert.equal(Object.values(roomy.placements).flat().length, 5);
});

test('planDrivers sizes from forward voltage when fV is the binding limit', () => {
  // 4 × 5W cables (20W — one driver on load alone) but 30fV each against a 55fV
  // node: only one fits per node, so it takes two 2CH drivers.
  const body = [...Array(4)].map((_, i) => `L${i + 1},HUB-G,5,0.35,30,CC,CG1`).join('\n');
  const p = engine.planDrivers(gfModel(body), {}, [], 'HUB-G', { margin: 0.05 });
  assert.equal(p.drivers.length, 2);
  assert.deepEqual(p.unplaced, []);
});

test('planDrivers keeps ControlGroups apart by default, mixes them when told to', () => {
  const body = `${gfLinks(2, 'CG1', 1)}\n${gfLinks(2, 'CG2', 3)}`;
  const m = gfModel(body);
  const split = engine.planDrivers(m, {}, [], 'HUB-G');
  assert.equal(split.drivers.length, 2); // one per group, though 4 × 20W would fit on one
  const groupOf = (r) => m.links.find((l) => l.ref === r).controlGroup;
  for (const refs of Object.values(split.placements)) {
    assert.equal(new Set(refs.map(groupOf)).size, 1);
  }
  const mixed = engine.planDrivers(m, {}, [], 'HUB-G', { restrictControlGroup: false });
  assert.equal(mixed.drivers.length, 1);
});

test('planDrivers reports cables no type in the library can take', () => {
  const body = 'L1,HUB-G,20,,24,CV,CG1';
  const p = engine.planDrivers(gfModel(body), {}, [], 'HUB-G');
  assert.deepEqual(p.drivers, []);
  assert.equal(p.unmatched.length, 1);
});

test('placeholder refs: internally tagged, but every one exports as E5000X', () => {
  assert.equal(engine.nextDriverRef(new Set()), 'E5000X');
  assert.equal(engine.nextDriverRef(new Set(['E5000X'])), 'E5000X~2');
  assert.equal(engine.nextDriverRef(new Set(['E5000X', 'E5000X~2'])), 'E5000X~3');
  assert.equal(engine.outRef('E5000X~3'), 'E5000X');
  assert.equal(engine.outRef('E50019'), 'E50019');
});

test('two added drivers export and patch under the one literal placeholder ref', () => {
  const m = gfModel(gfLinks(2));
  const added = [
    { ref: 'E5000X', typeRef: 'T100', zone: 'HUB-G' },
    { ref: 'E5000X~2', typeRef: 'T100', zone: 'HUB-G' },
  ];
  const a = {
    'E5000X|OP.1': { toEntityType: 'Link', refs: ['L1'] },
    'E5000X~2|OP.1': { toEntityType: 'Link', refs: ['L2'] },
  };
  const csv = engine.exportCsv(m, a, added);
  assert.ok(!csv.includes('~'));
  assert.equal(csv.split('"E5000X",,"T100"').length - 1, 4); // 2 drivers × 2 nodes
  const script = engine.generatePatchScript(m, a, added);
  assert.ok(!script.includes('~'));
  assert.equal(script.split('setValue("E5000X")').length - 1, 2); // one per placed cable
});

test('reordering a row back to its baseline set is not a change', () => {
  const model = { ...patchModel, baseline: { 'D1|OP.1': { toEntityType: 'Link', refs: ['X1', 'X2'] } } };
  const reordered = { 'D1|OP.1': { toEntityType: 'Link', refs: ['X2', 'X1'] } };
  assert.deepEqual(engine.changedRows(model, reordered, []), []);
  assert.ok(!engine.generatePatchScript(model, reordered, []).includes('X1'));
  assert.ok(engine.sameRefs(['a', 'b'], ['b', 'a']));
  assert.ok(!engine.sameRefs(['a'], ['a', 'b']));
});

test('a type that declares nothing is not a sizing candidate', () => {
  // "185W" alone: no CC/CV, no current, no node fV. It passes every
  // compatibility test by default and its blank limits read as infinite, so it
  // used to win every bucket — the biggest driver with no fV ceiling.
  const lib = `${GF_TYPES}TBIG,185W,,1\n`;
  const m = engine.buildModel(null, GF_HEAD + gfLinks(5) + '\n', lib);
  const p = engine.planDrivers(m, {}, [], 'HUB-G');
  assert.deepEqual(p.proposals.map((x) => x.typeRef), ['T100']);

  // ...and on its own it is no candidate at all, rather than a silent bad pick
  const only = engine.buildModel(null, GF_HEAD + gfLinks(5) + '\n', 'ElementTypeRef,Driver Restrictions\nTBIG,185W\n');
  const p2 = engine.planDrivers(only, {}, [], 'HUB-G');
  assert.deepEqual(p2.drivers, []);
  assert.equal(p2.unmatched.length, 1);
});

test('an emergency type loses a tie to an ordinary one', () => {
  const lib = 'ElementTypeRef,Driver Restrictions,Node Restrictions,Channels\n'
    + 'T-EM-01,100W | 0.35A,100W | 55fV,2\nT-STD-01,100W | 0.35A,100W | 55fV,2\n';
  const m = engine.buildModel(null, GF_HEAD + gfLinks(2) + '\n', lib);
  assert.deepEqual(engine.planDrivers(m, {}, [], 'HUB-G').proposals.map((x) => x.typeRef), ['T-STD-01']);
});

test('forward voltage alone can drive the count on real-shaped ratings', () => {
  // 5 × 11.8W/35fV cables: 59W fits one 50W... no — but fV is the tighter one,
  // 55fV a node means one cable per node, so it takes three 2CH drivers.
  const lib = 'ElementTypeRef,Driver Restrictions,Node Restrictions,Channels\nT-CC,50W | 0.3A,55fV,2\n';
  const body = [...Array(5)].map((_, i) => `L${i + 1},HUB-G,11.8,0.3,35,CC,CG1`).join('\n');
  const p = engine.planDrivers(engine.buildModel(null, GF_HEAD + body + '\n', lib), {}, [], 'HUB-G');
  assert.equal(p.drivers.length, 3);
  assert.deepEqual(p.unplaced, []);
});

// ---- driver type presets: patched or invented in the UI ----
const preset = (over = {}) => ({
  typeRef: 'T100', powerType: 'CC', maxPowerW: 100, currentA: 0.35,
  channels: 2, nodeMaxLoadW: 100, nodeMaxFvV: 55, invented: false, ...over,
});

test('a preset overrides the library and re-rates existing drivers of that type', () => {
  // TBIG declares only "185W": no CC/CV, no current, no fV. The hub has a driver
  // of that type, and it stays unusable until a human says what it is.
  const lib = `${GF_TYPES}TBIG,185W,,1\n`;
  const form = 'Pullzone,ElementRef,ElementTypeRef,Node,ToEntityType,ToEntityRefs\nHUB-G,E1,TBIG,OP.1,,\n';
  const links = GF_HEAD + gfLinks(2) + '\n';
  const before = engine.buildModel(form, links, lib);
  assert.equal(before.drivers[0].powerType, null);

  const after = engine.buildModel(form, links, lib,
    [preset({ typeRef: 'TBIG', maxPowerW: 185, currentA: 1.05, channels: 1, nodeMaxFvV: 60 })]);
  const d = after.drivers[0];
  assert.equal(d.powerType, 'CC');
  assert.equal(d.currentA, 1.05);
  assert.equal(d.nodes[0].maxFvV, 60);
  const t = after.inventory.find((x) => x.typeRef === 'TBIG');
  assert.equal(t.driverRestrictions, '185W | 1.05A'); // composed, so exports match a library row
  assert.equal(t.nodes.length, 1);
});

test('a preset rescues a bucket that no library type could take', () => {
  const links = GF_HEAD + [...Array(3)].map((_, i) => `L${i + 1},HUB-G,20,1.05,10,CC,CG1`).join('\n') + '\n';
  const bare = engine.planDrivers(engine.buildModel(null, links, GF_TYPES), {}, [], 'HUB-G');
  assert.equal(bare.unmatched.length, 1);           // 1.05A cables, 0.35A library
  assert.deepEqual(bare.drivers, []);

  const withPreset = engine.buildModel(null, links, GF_TYPES,
    [preset({ typeRef: 'ET-CCR-D-1050-2CH-01', currentA: 1.05, invented: true })]);
  const p = engine.planDrivers(withPreset, {}, [], 'HUB-G');
  assert.deepEqual(p.unmatched, []);
  assert.equal(p.proposals[0].typeRef, 'ET-CCR-D-1050-2CH-01');
});

test('nextTypeRef composes from the ratings, and reuses a sibling stem', () => {
  const inv = engine.buildModel(null, GF_HEAD + gfLinks(1) + '\n', GF_TYPES).inventory;
  // nothing like it in the library -> composed from CC / mA / channels
  assert.equal(engine.nextTypeRef(inv, { powerType: 'CC', currentA: 0.7, channels: 2 }),
    'ET-CCR-D-700-2CH-01');
  assert.equal(engine.nextTypeRef(inv, { powerType: 'CV', outputVoltageV: 24, channels: 1 }),
    'ET-CVR-D-24-1CH-01');
  // a sibling exists -> its stem wins, next free serial
  const sib = [{ typeRef: 'ET-CCR-D-700-2CH-01', powerType: 'CC', currentA: 0.7, nodes: [1, 2] }];
  assert.equal(engine.nextTypeRef(sib, { powerType: 'CC', currentA: 0.7, channels: 2 }),
    'ET-CCR-D-700-2CH-02');
  // incomplete draft proposes nothing
  assert.equal(engine.nextTypeRef(inv, { powerType: 'CC', channels: 2 }), '');
});

test('the patch writes ElementTypes columns, current in AMPS, IsPropertiesTBC on both', () => {
  const m = gfModel(gfLinks(2));
  const added = [{ ref: 'E5000X', typeRef: 'T-NEW', zone: 'HUB-G' }];
  const script = engine.generatePatchScript(m, {}, added, [
    preset({ typeRef: 'T100', currentA: 0.35 }),                    // patch: type is in the library
    preset({ typeRef: 'T-NEW', currentA: 0.7, invented: true }),    // invented, and used by E5000X
  ]);
  assert.match(script, /let ElementTypes=DB\.getWorksheet\("ElementTypes"\)/);
  assert.match(script, /find\("MaxPower\(W\)",\{completeMatch:true\}\)/);
  // amps, not mA: page 135910 is explicit, and NodeCurrent 6 on a 144W/24V output
  // could only ever be 6A. mA survives in the type ref alone.
  assert.match(script, /ET_CurrentRange\)\.setValue\(0\.35\)/);
  assert.match(script, /ET_CurrentRange\)\.setValue\(0\.7\)/);
  assert.ok(!script.includes('setValue(350)'));
  // the node list IS the channel count
  assert.equal(script.split('ET_Parameters).setValue("{<OP.1,<OP.2}")').length - 1, 2);
  assert.equal(script.split('ET_IsPropertiesTBC).setValue("Y")').length - 1, 2);
  // append path for a type that isn't there, patch path for one that is
  assert.match(script, /let r=f\?f\.getRowIndex\(\):ElementTypes\.getUsedRange\(\)\.getRowCount\(\)/);
  // the note is stamped on the new type only (the header declaration doesn't count)
  assert.equal(script.split('getCell(r,ET_InternalNotes)').length - 1, 1);
  assert.match(script, /Defined in the Driver Assignment Tool\./);
});

test('presets nobody uses are not patched, and no presets means the old script exactly', () => {
  const m = gfModel(gfLinks(2));
  const orphanPreset = [preset({ typeRef: 'T-UNUSED', invented: true })];
  assert.ok(!engine.generatePatchScript(m, {}, [], orphanPreset).includes('T-UNUSED'));
  assert.ok(!engine.generatePatchScript(m, {}, [], orphanPreset).includes('ElementTypes'));
  assert.equal(engine.generatePatchScript(m, {}, [], []), engine.generatePatchScript(m, {}, []));
});

test('a preset keeps the type\'s own node names — Parameters must not rename outputs', () => {
  const lib = 'ElementTypeRef,Node,Driver Restrictions,Node Restrictions\n'
    + 'T-ODD,A,50W | 0.35A,55fV\nT-ODD,B,50W | 0.35A,55fV\n';
  const m = engine.buildModel(null, GF_HEAD + gfLinks(2) + '\n', lib,
    [preset({ typeRef: 'T-ODD', nodeNames: ['A', 'B'] })]);
  assert.deepEqual(m.inventory.find((t) => t.typeRef === 'T-ODD').nodes.map((n) => n.name), ['A', 'B']);
  const script = engine.generatePatchScript(m, {}, [], [preset({ typeRef: 'T-ODD', nodeNames: ['A', 'B'] })]);
  assert.match(script, /ET_Parameters\)\.setValue\("\{<A,<B\}"\)/);
});

test('catalogue parts are addable and patch their datasheet columns', () => {
  const solo = engine.PARTS.find((t) => t.name === 'EldoLED SoloDrive 360/A');
  const local = engine.PARTS.find((t) => t.name === 'PowerLED PCV24100');
  assert.equal(solo.maxPowerW, 30);
  assert.equal(local.stem, 'ET-CVR-S-24-1CH');  // unswitched is -S-, not derivable

  // an empty library still gets a usable type out of the catalogue
  const links = GF_HEAD + [...Array(4)].map((_, i) => `L${i + 1},HUB-G,6,0.3,25,CC,CG1`).join('\n') + '\n';
  const p = {
    typeRef: 'ET-CCR-D-300-1CH-01', name: solo.name, powerType: 'CC', maxPowerW: solo.maxPowerW,
    currentA: 0.3, outputs: solo.outputs, addresses: solo.addresses, nodeMaxFvV: solo.maxFvV,
    controlType: solo.controlType, invented: true,
  };
  const m = engine.buildModel(null, links, null, [p]);
  assert.equal(m.inventory.length, 1);
  const plan = engine.planDrivers(m, {}, [], 'HUB-G');
  assert.equal(plan.drivers.length, 2);      // 55fV a node, 25fV a cable -> 2 per driver
  assert.deepEqual(plan.unplaced, []);

  const script = engine.generatePatchScript(m, {}, [{ ref: 'E5000X', typeRef: p.typeRef, zone: 'HUB-G' }], [p]);
  assert.match(script, /ET_CurrentRange\)\.setValue\(0\.3\)/);
  assert.match(script, /ET_Ballast\)\.setValue\(1\)/);        // addresses, not outputs
  assert.match(script, /ET_ControlType\)\.setValue\("DALI"\)/);
  assert.match(script, /ET_Parameters\)\.setValue\("\{<OP\.1\}"\)/);

  // the 720D's per-output cap is watts only once a supply names the rail
  const four = engine.resolveSpec('EldoLED LinearDrive 720D & Meanwell HLG-600-24');
  assert.equal(four.nodeMaxLoadW, 144);
  const p4 = { typeRef: 'T4', name: four.name, powerType: 'CV', maxPowerW: four.maxPowerW,
    outputVoltageV: four.outputV, outputs: four.outputs, addresses: four.addresses,
    nodeMaxLoadW: four.nodeMaxLoadW, nodeCurrentA: four.nodeCurrentA, invented: true };
  const s4 = engine.generatePatchScript(m, {}, [{ ref: 'E5000X', typeRef: 'T4', zone: 'HUB-G' }], [p4]);
  assert.match(s4, /ET_NodeMaxPower\)\.setValue\(144\)/);
  assert.match(s4, /ET_NodeCurrent\)\.setValue\(6\)/);
  assert.match(s4, /ET_Parameters\)\.setValue\("\{<OP\.1,<OP\.2,<OP\.3,<OP\.4\}"\)/);
});

test('a ref counts DALI addresses, not outputs', () => {
  // SoloDrive 560/A: two outputs on one address -> 1CH, and two nodes
  const solo560 = engine.PARTS.find((t) => t.name === 'EldoLED SoloDrive 560/A');
  assert.equal(solo560.outputs, 2);
  assert.equal(solo560.addresses, 1);
  assert.equal(
    engine.nextTypeRef([], { powerType: 'CC', currentA: 0.7, outputs: 2, addresses: 1 }),
    'ET-CCR-D-700-1CH-01',
  );
  // DualDrive 560/A: the same two outputs, but two addresses -> 2CH
  assert.equal(
    engine.nextTypeRef([], { powerType: 'CC', currentA: 0.7, outputs: 2, addresses: 2 }),
    'ET-CCR-D-700-2CH-01',
  );
  const t = engine.presetToType({ typeRef: 'X', powerType: 'CC', maxPowerW: 50, currentA: 0.7,
    outputs: 2, addresses: 1 });
  assert.equal(t.nodes.length, 2);   // Parameters
  assert.equal(t.ballast, 1);        // BallastCountPerUoM
});

test('nextTypeRef honours a stock stem', () => {
  assert.equal(
    engine.nextTypeRef([], { powerType: 'CV', outputVoltageV: 24, channels: 1, stem: 'ET-CVR-S-24-1CH' }),
    'ET-CVR-S-24-1CH-01',
  );
});

test('mA notation parses as amps — a unit variation is not missing data', () => {
  for (const raw of ['50W | 350mA', '50W|350 mA', '50W | 350MA']) {
    assert.deepEqual(engine.parseDriverRestrictions(raw),
      { powerType: 'CC', maxPowerW: 50, currentA: 0.35, outputVoltageV: null }, raw);
  }
  // amps still mean amps, and the CV forms are untouched
  assert.equal(engine.parseDriverRestrictions('50W | 0.35A').currentA, 0.35);
  assert.equal(engine.parseDriverRestrictions('180W | 24V').outputVoltageV, 24);

  // and such a type is now a sizing candidate rather than silently refused
  const lib = 'ElementTypeRef,Driver Restrictions,Node Restrictions,Channels\nT-MA,50W | 350mA,50W | 55fV,2\n';
  const m = engine.buildModel(null, GF_HEAD + gfLinks(2) + '\n', lib);
  assert.equal(m.inventory[0].currentA, 0.35);
  assert.deepEqual(engine.planDrivers(m, {}, [], 'HUB-G').unmatched, []);
});

test('names travel with the refs, and are optional', () => {
  const form = 'Pullzone,ElementRef,ElementName,ElementTypeRef,ElementTypeName,Node,ToEntityType,ToEntityRefs\n'
    + 'HUB-G,E1,Study driver 1,T100,DualDrive 560/A,OP.1,,\n';
  const m = engine.buildModel(form, GF_HEAD + gfLinks(2) + '\n', GF_TYPES);
  assert.equal(m.drivers[0].name, 'Study driver 1');
  assert.equal(m.drivers[0].typeName, 'DualDrive 560/A');
  // the library row carries no name, so the one the hub rows state is kept
  assert.equal(m.inventory.find((t) => t.typeRef === 'T100').name, 'DualDrive 560/A');

  // the library's own name wins, and a CSV without the columns still parses
  const named = 'ElementTypeRef,ElementTypeName,Driver Restrictions,Node Restrictions,Channels\n'
    + 'T100,DualDrive 560/A,100W | 0.35A,100W | 55fV,2\n';
  assert.equal(engine.buildModel(null, GF_HEAD + gfLinks(1) + '\n', named).inventory[0].name, 'DualDrive 560/A');
  assert.equal(engine.buildModel(null, GF_HEAD + gfLinks(1) + '\n', GF_TYPES).inventory[0].name, '');
});

// ---- third mode: estimate from a requirement assessment (DJ 100053) ----
const ASSESS_HEAD = 'Link_SecondaryPowerRef,LocationName,ControlTypeRef,ControlGrouptext,'
  + 'PositionTypeRef,SumQuantity,ControlAddressCount,CC/CV,CV_Voltage,CC_Current,SumVf,SumPower\n';
const EST_TYPES = 'ElementTypeRef,ElementTypeName,Driver Restrictions,Node Restrictions,Channels\n'
  + 'ET-CCR-D-350-2CH-01,EldoLED DualDrive 560/A,50W | 0.35A,55fV,2\n'
  + 'ET-CVR-D-24-2CH-01,EldoLED LinearDrive 220D,185W | 24V,,2\n';
// 40 downlights, 3W and 12fV each
const DL40 = 'P50447,Study,DALI,CG1,PT-DL,40,1,CC,,0.35,480,120\n';

test('an assessment row is a quantity of fittings, not a cable', () => {
  const m = engine.buildEstimate(ASSESS_HEAD + DL40, EST_TYPES);
  assert.equal(m.mode, 'estimate');
  assert.deepEqual(m.links, []);
  assert.deepEqual(m.zones, ['P50447']);
  const r = m.requirements[0];
  assert.equal(r.qty, 40);
  assert.equal(r.wPer, 3);      // 120W / 40
  assert.equal(r.fvPer, 12);    // 480fV / 40
  assert.equal(engine.detectKind(ASSESS_HEAD + DL40), 'assessment');
});

test('the count is fV per output, as page 135910 teaches it', () => {
  // 55fV a node at 12V a fitting is 4 per output, 8 on a 2-output driver,
  // so 40 fittings need 5 drivers — whatever the wattage says.
  const m = engine.buildEstimate(ASSESS_HEAD + DL40, EST_TYPES);
  const [z] = engine.estimate(m, { margin: 0 });
  assert.equal(z.lines.length, 1);
  assert.equal(z.lines[0].perNode, 4);
  assert.equal(z.lines[0].perDriver, 8);
  assert.equal(z.lines[0].count, 5);
  assert.equal(z.lines[0].limit, 'fV');
  assert.equal(z.drivers, 5);

  // 5% margin takes a node to 52.25fV, still 4 fittings — the count holds
  assert.equal(engine.estimate(m, { margin: 0.05 })[0].lines[0].count, 5);
  // 20% takes it to 44fV, so 3 per output and 7 drivers
  const tight = engine.estimate(m, { margin: 0.2 })[0].lines[0];
  assert.equal(tight.perNode, 3);
  assert.equal(tight.count, 7);
});

test('watts bind when forward voltage does not', () => {
  // 10 linear at 24W on a 185W CV driver: 185 x 0.95 / 24 = 7 per driver
  const cv = 'P50003,Hall,DALI,CG2,PT-LIN,10,1,CV,24,,,240\n';
  const [z] = engine.estimate(engine.buildEstimate(ASSESS_HEAD + cv, EST_TYPES), { margin: 0.05 });
  assert.equal(z.lines[0].perDriver, 7);
  assert.equal(z.lines[0].count, 2);
  assert.equal(z.lines[0].limit, 'driver W');
});

test('one ControlGroup per driver splits the estimate, as it does the assignment', () => {
  const two = ASSESS_HEAD
    + 'P50447,Study,DALI,CG1,PT-DL,4,1,CC,,0.35,48,12\n'
    + 'P50447,Study,DALI,CG2,PT-DL,4,1,CC,,0.35,48,12\n';
  const m = engine.buildEstimate(two, EST_TYPES);
  // 8 fittings fit one driver, but not two ControlGroups on it
  assert.equal(engine.estimate(m, { margin: 0 })[0].drivers, 2);
  assert.equal(engine.estimate(m, { margin: 0, restrictControlGroup: false })[0].drivers, 1);
});

test('fittings no type can take are reported, not silently dropped', () => {
  const odd = ASSESS_HEAD + 'P50447,Study,DALI,CG1,PT-BIG,5,1,CC,,0.7,300,500\n';
  const [z] = engine.estimate(engine.buildEstimate(odd, EST_TYPES));
  assert.deepEqual(z.lines, []);
  assert.equal(z.unmatched[0].qty, 5);
  assert.equal(z.drivers, 0);
});

test('the estimate patch appends Elements rows carrying a Quantity', () => {
  const m = engine.buildEstimate(ASSESS_HEAD + DL40, EST_TYPES);
  const script = engine.generateEstimatePatch(engine.estimate(m, { margin: 0 }));
  assert.match(script, /let Elements=DB\.getWorksheet\("Elements"\)/);
  assert.match(script, /find\("Quantity",\{completeMatch:true\}\)/);
  assert.match(script, /EL_Ref\)\.setValue\("E5000X"\)/);
  assert.match(script, /EL_TypeRef\)\.setValue\("ET-CCR-D-350-2CH-01"\)/);
  assert.match(script, /EL_ContextType\)\.setValue\("Position"\)/);
  assert.match(script, /EL_ContextRef\)\.setValue\("P50447"\)/);
  assert.match(script, /EL_Quantity\)\.setValue\(5\)/);   // one row, not five
  assert.equal(script.split('EL_row++').length - 1, 1);
  // and it never touches LinksMap rows, because there are none
  assert.ok(!script.includes('FromLinkEndContextRef).setValue'));
});

test('an assessment without a type library is refused', () => {
  assert.throws(() => engine.buildEstimate(ASSESS_HEAD + DL40, ''), /nothing to size the estimate against/);
});

test('the mode comes from the circumstance, not from which file was dropped', () => {
  assert.equal(engine.detectMode({ drivers: 6, links: 26 }).mode, 'assign');
  assert.equal(engine.detectMode({ drivers: 0, links: 26 }).mode, 'greenfield');
  assert.equal(engine.detectMode({ requirements: 12 }).mode, 'estimate');
  // dead ends name the file that would fix them
  assert.equal(engine.detectMode({ drivers: 4 }).mode, null);
  assert.match(engine.detectMode({ drivers: 4 }).reason, /DJ 100053/);
  assert.match(engine.detectMode({}).reason, /DJ 100053/);

  // and a built model carries what it decided
  const m = engine.buildModel(null, GF_HEAD + gfLinks(2) + '\n', GF_TYPES);
  assert.equal(m.mode, 'greenfield');
  assert.equal(m.modeReason, '2 cables, no drivers yet');
  assert.equal(engine.buildEstimate(ASSESS_HEAD + DL40, EST_TYPES).mode, 'estimate');
});

test('a links CSV with a header and no cables parses, then names what is missing', () => {
  // Header-only used to throw "file is empty", which read as a broken export.
  // It is a real circumstance: the hub has no cables yet.
  const empty = 'LinkRef,PullZone,LinkSumPower(W),SecondaryPowerType\n';
  const form = 'Pullzone,ElementRef,ElementTypeRef,Node\nHUB-G,E1,T100,OP.1\n';
  assert.throws(() => engine.buildModel(null, empty, GF_TYPES), /nothing to work from/);
  assert.throws(() => engine.buildModel(form, empty, GF_TYPES), /drivers but no cables/);
  // both messages point at the file that would fix it
  assert.throws(() => engine.buildModel(form, empty, GF_TYPES), /DJ 100053/);
});

test('a type library may state the ElementTypes columns instead of the composed string', () => {
  const explicit = 'ElementTypeRef,ElementTypeName,MaxPower(W),CurrentRange,OutputVoltage(V),'
    + 'NodeMaxPower(W),NodeMaxForwardVoltage(fV),ControlType,BallastCountPerUoM,Channels\n'
    + 'ET-CCR-D-350-2CH-01,EldoLED DualDrive 560/A,50,0.35,,,55,DALI,2,2\n';
  const composed = 'ElementTypeRef,ElementTypeName,Driver Restrictions,Node Restrictions,Channels\n'
    + 'ET-CCR-D-350-2CH-01,EldoLED DualDrive 560/A,50W | 0.35A,55fV,2\n';
  const a = engine.parseTypes(explicit)[0];
  const b = engine.parseTypes(composed)[0];
  for (const k of ['typeRef', 'name', 'powerType', 'maxPowerW', 'currentA', 'driverRestrictions']) {
    assert.deepEqual(a[k], b[k], k);
  }
  assert.equal(a.nodes.length, 2);
  assert.equal(a.nodes[0].maxFvV, 55);
  assert.equal(a.ballast, 2);
  assert.equal(a.controlType, 'DALI');

  // the composed form is order-dependent and loses the rating to a driver-level
  // fV — which is exactly why the explicit columns are preferred
  const bad = engine.parseTypes('ElementTypeRef,Driver Restrictions,Channels\nET-X,50W | 55fV | 0.35A,2\n')[0];
  assert.equal(bad.powerType, null);
  assert.equal(bad.maxPowerW, 50);
  // stated outright, the same driver survives
  const good = engine.parseTypes('ElementTypeRef,MaxPower(W),CurrentRange,NodeMaxForwardVoltage(fV),Channels\n'
    + 'ET-X,50,0.35,55,2\n')[0];
  assert.equal(good.powerType, 'CC');
  assert.equal(good.currentA, 0.35);
});

test('the estimate ranks types by ITS count, not by watts', () => {
  // Two 35fV fittings on a 55fV node need two outputs: 35 + 35 is 70, over the
  // node. So a 2CH part holds the pair on one driver and a 1CH part of the same
  // wattage needs two. Ranking on watts prefers the 1CH (less wasted capacity)
  // and doubles the estimate — real data at P50446 went 12 drivers instead of 7.
  const types = 'ElementTypeRef,ElementTypeName,MaxPower(W),CurrentRange,NodeMaxForwardVoltage(fV),Channels\n'
    + 'ET-1CH,SoloDrive,30,0.3,55,1\n'
    + 'ET-2CH,DualDrive,50,0.3,55,2\n';
  const rows = ASSESS_HEAD + 'P50446,Drawing Rooms,DALI,L103-H-03,B02w,2,1,CC,,0.3,70,23.6\n';
  const [z] = engine.estimate(engine.buildEstimate(rows, types), { margin: 0.05 });
  assert.equal(z.lines[0].typeRef, 'ET-2CH');
  assert.equal(z.lines[0].perNode, 1);      // one fitting per output, fV bound
  assert.equal(z.lines[0].perDriver, 2);    // two outputs
  assert.equal(z.lines[0].count, 1);        // not 2
  assert.equal(z.lines[0].limit, 'fV');

  // and with only the 1CH part available it still answers, with two drivers
  const only1 = 'ElementTypeRef,MaxPower(W),CurrentRange,NodeMaxForwardVoltage(fV),Channels\nET-1CH,30,0.3,55,1\n';
  assert.equal(engine.estimate(engine.buildEstimate(rows, only1), { margin: 0.05 })[0].lines[0].count, 2);
});
