// The hub layout patch. Every cell it writes can already hold other Parameter
// Syntax flavours, so the merge is tested on its own, then the script around it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as hl from '../../src/hubLayout.js';
import { hubPatch, MERGE_TS } from '../../src/drivers/hubPatch.js';

// the exact merge the script runs, with its TypeScript annotations taken off
const merge = new Function(`${MERGE_TS.replace(/: (string|number)/g, '')}; return mergeFlavour;`)();
const I = (ref, w = 210, h = 40) => ({ ref, label: ref, size: [w, h, 150] });
const POS = { ref: 'P8110', name: '#1', contextType: 'Position' };

test('a size written into a type leaves its nodes, and its capacity, alone', () => {
  assert.equal(merge('{<OP.1,<OP.2}', 'size', '[153mm,50mm,23mm]'), '[153mm,50mm,23mm]{<OP.1,<OP.2}');
  assert.equal(merge('[80mm,30mm,]{<OP.1}', 'size', '[153mm,50mm,23mm]'), '[153mm,50mm,23mm]{<OP.1}',
    'an existing size is replaced, not duplicated');
  assert.equal(merge('[[380mm,1mm,150mm]]<1,2>', 'size', '[1mm,2mm,3mm]'), '[1mm,2mm,3mm][[380mm,1mm,150mm]]<1,2>',
    'a double bracket is capacity, never mistaken for a size');
  const once = merge('{<OP.1}', 'size', '[153mm,50mm,23mm]');
  assert.equal(merge(once, 'size', '[153mm,50mm,23mm]'), once, 'writing the same size twice changes nothing');
});

test('a hub size replaces capacity and bays, and clears when every bay has left', () => {
  const next = merge(merge('[[1mm,1mm,1mm]]<1>{x}', 'spaces', '<1,2>'), 'capacity', '[[710mm,400mm,150mm]]');
  assert.equal(next, '[[710mm,400mm,150mm]]<1,2>{x}');
  assert.equal(merge(merge('[[1mm,1mm,1mm]]<1>', 'spaces', ''), 'capacity', ''), '');
});

test('a Position hub is patched on the Positions sheet, and drivers on Elements', () => {
  const s = hubPatch({ saved: hl.save([[I('A'), I('B', 153.6, 76.7)]], { container: POS }), hub: POS });
  assert.match(s, /DB\.getWorksheet\("Positions"\)/);
  assert.match(s, /columnIndex\(WS_E, "ContextParameters", true\)/, 'added to a book that lacks it');
  assert.match(s, /"xyz":"\[50mm,25mm,0mm\]"/);
  assert.match(s, /"spaces":"<1>"/);
  assert.match(s, /rowOf_P\.get\("P8110"\)/);
  assert.doesNotMatch(s, /setValue\(""\)/);
  assert.equal(s.split('function main(').length - 1, 1);
});

test('an Element hub is patched on Elements, and the Positions sheet is never opened', () => {
  const hub = { ref: 'E80023', contextType: 'Element' };
  const s = hubPatch({ saved: hl.save([[I('A')]], { container: hub }), hub });
  assert.doesNotMatch(s, /getWorksheet\("Positions"\)/);
  assert.match(s, /rowOf_E\.get\("E80023"\)/);
});

test('type sizes are written to ElementTypes, merged', () => {
  const s = hubPatch({ saved: hl.save([[I('A')]], { container: POS }), hub: POS,
    typeSizes: [{ ref: 'ET-CVR-D-24-2CH-01', size: '[153mm,50mm,23mm]' }] });
  assert.match(s, /DB\.getWorksheet\("ElementTypes"\)/);
  assert.match(s, /"size":"\[153mm,50mm,23mm\]"/);
  assert.match(s, /mergeFlavour\(was, "size", t\.size\)/);
});

test('a separated bay is added, and its drivers are pointed at it', () => {
  const bays = hl.moveItem(hl.addBay([[I('A'), I('C')]]), 'C', 1, 0);
  const placeholder = hubPatch({ saved: hl.save(bays, { container: POS, separate: [1] }), hub: POS });
  assert.match(placeholder, /"ref":"E5000X","isNew":true/);
  assert.match(placeholder, /"contextType":"Element","contextRef":"E5000X"/);
  assert.match(placeholder, /give it a real Ref/);
  const named = hubPatch({ saved: hl.save(bays, { container: POS, separate: [1], wrapperRefs: { 1: 'E90215' } }), hub: POS });
  assert.match(named, /"ref":"E90215","isNew":false/);
  assert.match(named, /"contextRef":"E90215"/);
});

test('without a hub Ref the hub size is reported, not guessed at', () => {
  const s = hubPatch({ saved: hl.save([[I('A')]], {}), hub: null });
  assert.match(s, /CHECK: no hub Ref was sent/);
  assert.doesNotMatch(s, /getWorksheet\("Positions"\)/);
});

test('Feed Provision is a real Element, placed and written like a driver', () => {
  const feed = { ref: 'E50027', kind: 'feed', label: 'Feed Provision', size: [280, 105, 50] };
  const s = hubPatch({ saved: hl.save([[feed, I('A')]], { container: POS }), hub: POS });
  assert.match(s, /"ref":"E50027","xyz":"\[50mm,25mm,0mm\]","spaces":"<1>"/);
});

test('a TBC flag set here is written after every clear, on the sheet it belongs to', () => {
  const s = hubPatch({ saved: hl.save([[I('E1')]], { container: POS }), hub: POS, tbc: [
    { ref: 'E1', sheet: 'E', isTBC: true, isPropertiesTBC: false },
    { ref: 'ET-CCR-FEED-PROV', sheet: 'ET', isTBC: false, isPropertiesTBC: true },
  ] });
  assert.match(s, /"ref":"E1","isTBC":true,"isPropertiesTBC":false/);
  assert.match(s, /DB\.getWorksheet\("ElementTypes"\)/, 'a type flag opens ElementTypes with no size to write');
  assert.ok(s.indexOf('const tbc_E') > s.lastIndexOf('col_E_IsPropertiesTBC).clear'),
    'the flag comes after the clear that would otherwise undo it');
  assert.match(s, /tbc\.setValue\("Y"\)/);
  assert.doesNotMatch(s, /setValue\(""\)/);
});

test('the merge reads by depth: a size inside a space is never the entity size', () => {
  const hub = '[[838mm,418mm,150mm]]<1[338mm,418mm,150mm,0,0,0],2[550mm,418mm,150mm,288mm,0,0]>';
  assert.equal(merge(hub, 'size', '[1mm,2mm,3mm]'), `[1mm,2mm,3mm]${hub}`, 'no top-level size to replace');
  assert.equal(merge(hub, 'spaces', '<1[380mm,418mm,150mm,0,0,0]>'), '<1[380mm,418mm,150mm,0,0,0]>[[838mm,418mm,150mm]]');
  const wrap = '[233mm,123mm,39mm]<PSU(ET-CVR-PSU-24)[228mm,68mm,39mm,0,55mm,0]>{<OP.1,<OP.2}';
  assert.equal(merge(wrap, 'size', '[240mm,130mm,39mm]'), '[240mm,130mm,39mm]<PSU(ET-CVR-PSU-24)[228mm,68mm,39mm,0,55mm,0]>{<OP.1,<OP.2}');
  assert.equal(merge(wrap, 'nodes', ''), '[233mm,123mm,39mm]<PSU(ET-CVR-PSU-24)[228mm,68mm,39mm,0,55mm,0]>');
});

test('a wrapper type gets its parts as spaces, and a driver Element its junction boxes', () => {
  const s = hubPatch({ saved: hl.save([[I('E1')]], { container: POS }), hub: POS,
    typeSizes: [
      { ref: 'ET-CVR-D-24-2CH-01', size: '[238mm,128mm,39mm]', spaces: '<Driver(ET-CVR-01)[153mm,50mm,23mm,0,0,0]>' },
      { ref: 'ET-CVR-01', size: '[153mm,50mm,23mm]' },
    ],
    jb: { E1: '<JB.1[80mm,35mm,40mm,158mm,0,0]>' } });
  assert.match(s, /"ref":"ET-CVR-D-24-2CH-01","size":"\[238mm,128mm,39mm\]","setSpaces":true,"spaces":"<Driver\(ET-CVR-01\)/);
  assert.match(s, /"ref":"ET-CVR-01","size":"\[153mm,50mm,23mm\]","setSpaces":false,"spaces":""/);
  assert.match(s, /"ref":"E1",.*"setJb":true,"jb":"<JB\.1\[80mm/);
  assert.match(s, /mergeFlavour\(nextP, "spaces", it\.jb\)/);
  assert.doesNotMatch(s, /_EE\|/, 'a generated row is never written');
});

test('the contract: a hub is recreated from only what the patch writes', async () => {
  const r = await import('../../src/drivers/recipe.js');
  // a hub with a typed bay width, a turned module, junction boxes and moved parts
  const types = {
    'ET-CVR-01': { name: '220D', params: '{<OP.1,<OP.2}' },
    'ET-CVR-PSU-24': { name: 'HLG-185-24', params: '', outputVoltageV: 24 },
  };
  const wrapper = { typeRef: 'ET-CVR-D-24-2CH-01', name: 'x', params: '{<OP.1,<OP.2}' };
  const parts = [
    { space: 'Driver', role: 'Driver', typeRef: 'ET-CVR-01', size: [153, 50, 23], at: [0, 0, 0] },
    { space: 'PSU', role: 'PSU', typeRef: 'ET-CVR-PSU-24', size: [228, 68, 39], at: [15, 60, 0] },
  ];
  const mod = r.compose(parts, 2);
  const item = { ref: 'E1', typeRef: wrapper.typeRef, size: mod.size, rot: 90 };
  const bays = [[I('A')], [item]];
  const widths = [380, 520];
  const saved = hl.save(bays, { container: POS, widths });

  // apply the patch's own merge to empty cells, exactly as the script does
  const cell = {};
  cell.hub = merge(merge('', 'spaces', `<${hl.parseParams(saved.container.parameters).spaces}>`), 'capacity',
    hl.formatParams({ capacity: hl.parseParams(saved.container.parameters).capacity }));
  cell.el = Object.fromEntries(saved.elements.map((e) => {
    const cp = hl.parseParams(e.contextParameters);
    return [e.ref, {
      contextParameters: merge(merge('', 'spaces', `<${cp.spaces}>`), 'size', hl.formatParams({ size: cp.size })),
      parameters: merge(e.parameters ? merge('', 'size', e.parameters) : '', 'spaces',
        e.ref === 'E1' ? r.elementParams('', 2, parts).replace(/^.*?(<.*>).*$/, '$1') : ''),
    }];
  }));
  cell.wrapper = merge(merge(wrapper.params, 'size', hl.formatParams({ size: r.envelope(parts) })), 'spaces',
    `<${hl.parseParams(r.wrapperParams('', parts)).spaces}>`);

  // and rebuild from those cells with no session state at all
  const back = r.partsFor({ wrapper: { ...wrapper, params: cell.wrapper }, types });
  assert.equal(back.source, 'spaces');
  assert.deepEqual(back.parts.map((p) => [p.space, p.at]), parts.map((p) => [p.space, p.at]));
  assert.equal(r.jbCount(cell.el.E1.parameters), 2);
  const again = r.compose(back.parts, r.jbCount(cell.el.E1.parameters));
  const byRef = { A: I('A'), E1: { ...item, size: again.size, rot: 0 } };
  const loaded = hl.load({ container: cell.hub, elements: saved.elements.map((e) => ({ ...e, ...cell.el[e.ref] })) }, byRef);
  const geo = hl.bayGeometry(cell.hub);
  // an upright part comes back as rot 0 where it went in with none
  assert.deepEqual(hl.placements(loaded, { widths: geo.widths }).map((p) => [p.ref, p.slot, p.x, p.y, p.rot ?? 0]),
    hl.placements(bays, { widths }).map((p) => [p.ref, p.slot, p.x, p.y, p.rot ?? 0]));
});

test('breaking a quantity apart keeps one on the row and appends the rest where they were placed', () => {
  const bays = [[I('E50028')], [I('E5000X'), I('E5000X~2')]];
  const s = hubPatch({ saved: hl.save(bays, { container: POS }), hub: POS,
    quantities: [{ ref: 'E50028', quantity: 1 }],
    newElements: { E5000X: { typeRef: 'ET-CCR-D-300-2CH-01', name: 'SOLODrive' }, 'E5000X~2': { typeRef: 'ET-CCR-D-300-2CH-01', name: 'SOLODrive' } } });
  assert.match(s, /"ref":"E50028","quantity":1/);
  assert.match(s, /col_E_Quantity\)\.setValue\(q\.quantity\)/);
  const appended = s.match(/"ref":"E5000X","name":"SOLODrive","typeRef":"ET-CCR-D-300-2CH-01","contextType":"Position","contextRef":"P8110","contextParameters":"\[[^"]+\]<2>"/g) ?? [];
  assert.equal(appended.length, 2, 'both broken-out drivers appended, placed in bay 2');
  assert.doesNotMatch(s, /"ref":"E5000X~2"/, 'the placeholder is written as the placeholder');
  assert.doesNotMatch(s, /rowOf_E\.get\(it\.ref\)[\s\S]*"ref":"E5000X","xyz"/, 'not looked up as if it already existed');
  assert.match(s, /let nextRow_E = data_E\.length;/);
});
