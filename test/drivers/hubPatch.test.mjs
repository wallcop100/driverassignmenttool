// The hub layout patch. Every cell it writes can already hold other Parameter
// Syntax flavours, so the merge is tested on its own, then the script around it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as hl from '../../src/hubLayout.js';
import { hubPatch, MERGE_TS } from '../../src/drivers/hubPatch.js';

// the exact merge the script runs, with its TypeScript annotations taken off
const merge = new Function(`${MERGE_TS.replace(/: string/g, '')}; return mergeFlavour;`)();
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
