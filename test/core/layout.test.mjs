// core/layout.js holds no opinion about what is being arranged. These tests use
// a lighting control panel and its modules - never a hub or a driver - because
// if any hub assumption is still baked in, this is where it shows.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as L from '../../src/core/layout.js';

// a DIN module: 17.5mm wide, 90 tall. Nothing here is a driver.
const MOD = (ref, w = 17.5, h = 90) => ({ ref, label: ref, size: [w, h, 60] });
const PANEL = { ref: 'E41592', name: '#LCP5', contextType: 'Element' };

const bayNames = (params) => L.bayGeometry(params).held.map(String);

test('a container holds slots and a slot holds items - no hub anywhere', () => {
  const slots = [[MOD('A'), MOD('B')], [MOD('C')]];
  const placed = L.placements(slots, { slotWidth: 250 });
  assert.deepEqual(placed.map((p) => p.ref), ['A', 'B', 'C']);
  assert.deepEqual([...new Set(placed.map((p) => p.slot))], [0, 1]);
});

test('the geometry constants are defaults, not a law', () => {
  // a panel is not 380 wide and its modules do not want 50mm of trunking
  const slots = [[MOD('A'), MOD('B'), MOD('C')]];
  const wide = L.extent(slots, { slotWidth: 250 });
  const narrow = L.extent(slots, { slotWidth: 120 });
  assert.equal(wide.w, 250);
  assert.equal(narrow.w, 120);
  assert.ok(narrow.h >= wide.h, 'a narrower container is no shorter');
});

test('the save/load round trip works for a panel as it does for a hub', () => {
  const slots = [[MOD('A'), MOD('B')], [MOD('C')]];
  const opts = { container: PANEL, slotWidth: 250 };
  const saved = L.save(slots, opts);

  // the container names the slots it holds, in <discrete spaces>
  assert.deepEqual(bayNames(saved.container.parameters), ['1', '2']);
  assert.equal(saved.container.contextType, 'Element', 'a panel is an Element');
  // every module is contexted into the panel, at a slot and a coordinate
  for (const e of saved.elements) {
    assert.equal(e.contextType, 'Element');
    assert.equal(e.contextRef, 'E41592');
    assert.match(e.contextParameters, /^\[.*\]<A\.\d>$/, 'in its piece, A');
  }

  const byRef = Object.fromEntries(slots.flat().map((i) => [i.ref, { ...i, rot: 0 }]));
  const back = L.load(saved, byRef, opts);
  assert.deepEqual(back.map((s) => s.map((i) => i.ref)), [['A', 'B'], ['C']]);
  assert.deepEqual(L.save(back, opts), saved, 'and saving it again is identical');
});

test('no wrapper type is invented when a caller does not name one', () => {
  // the hub has a generic enclosure; a panel may have nothing to split into
  const slots = [[MOD('A')], [MOD('B')]];
  const bare = L.save(slots, { container: PANEL, separate: [1], enclosures: true });
  assert.equal(bare.slots[0].typeRef, null, 'core never picks a type');
  const named = L.save(slots, { container: PANEL, separate: [1], enclosures: true, wrapperType: 'ET-LCP-SUB' });
  assert.equal(named.slots[0].typeRef, 'ET-LCP-SUB');
});

test('the edits are container-agnostic', () => {
  let slots = [[MOD('A'), MOD('B')]];
  slots = L.addSlot(slots);
  assert.equal(slots.length, 2);
  slots = L.moveItem(slots, 'B', 1, 0);
  assert.deepEqual(slots.map((s) => s.map((i) => i.ref)), [['A'], ['B']]);
  slots = L.removeSlot(slots);
  assert.deepEqual(slots.map((s) => s.map((i) => i.ref)), [['A', 'B']], 'contents tip back');
  assert.deepEqual(L.splitToSlot(slots, ['B']).map((s) => s.map((i) => i.ref)), [['A'], ['B']]);
});

// ---- a slot can be its own width ------------------------------------------
const PART = (ref, w = 210, h = 40) => ({ ref, label: ref, size: [w, h, 150] });

test('equal widths put slots exactly where the single pitch did', () => {
  // each slot keeps its own trunking, so the next starts where this one ends
  assert.deepEqual(L.offsetsOf(3, { slotWidth: 380 }), [0, 380, 760]);
  assert.deepEqual(L.offsetsOf(3, { slotWidth: 380, joined: true }), [0, 330, 660], 'a shared divider, when asked for');
});

test('a wider bay beside a standard one moves everything after it', () => {
  const slots = [[PART('A')], [PART('B')]];
  const opts = { widths: [500, 380] };
  // 500 + 380, each keeping its own trunking
  assert.equal(L.extent(slots, opts).w, 880);
  const b = L.placements(slots, opts).find((p) => p.ref === 'B');
  assert.equal(b.x, 500 + L.TRUNK, 'bay 2 starts where bay 1 ends, then its trunking inset');
  assert.equal(L.widthAt(1, opts), 380);
  assert.equal(L.widthAt(5, opts), L.SLOT_WIDTH, 'an unset width is the house width');
});

test('a wider bay takes more across a row than a standard one', () => {
  const turned = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => ({ ...PART(`D${n}`), rot: 90 }));
  assert.ok(L.packSlot(turned, 500)[0].at.length > L.packSlot(turned, 380)[0].at.length);
});

test('per-bay widths survive the save and load round trip, separated bays included', () => {
  const slots = [[PART('A'), PART('B', 153.6, 76.7)], [PART('C')], [PART('D', 153.6, 76.7)]];
  const byRef = Object.fromEntries(slots.flat().map((i) => [i.ref, { ...i, rot: 0 }]));
  const opts = { widths: [380, 520, 400], separate: [2],
    container: { ref: 'P1', name: '#1', contextType: 'Position' } };
  const draw = (s) => L.placements(s, opts).map((p) => [p.ref, p.slot, p.x, p.y]);

  // spaces: the whole hub on its own row, the separated bay in a group of its own
  const spaces = L.save(slots, opts);
  assert.match(spaces.container.parameters, /^\[\[1300mm,/, '380 + 520 + 400');
  assert.deepEqual(L.parseParams(spaces.container.parameters).spaceList.map((s) => s.name), ['A.1', 'A.2', 'B.1']);
  assert.deepEqual(draw(L.load(spaces, byRef)), draw(slots));

  // enclosures: one per piece, each stating its own width
  const enc = L.save(slots, { ...opts, enclosures: true, pieceRefs: { A: 'E0', B: 'E1' } });
  assert.match(enc.slots[0].parameters, /^\[\[900mm,/, 'piece A is 380 + 520');
  assert.match(enc.slots[1].parameters, /^\[\[400mm,/, 'piece B states its own width');
  assert.deepEqual(draw(L.load(enc, byRef)), draw(slots));
});

test('a slot with no width typed is as wide as what it holds', () => {
  // three upright modules: 17.5 each, a shared 50 between, 50 trunking each side
  assert.equal(L.naturalWidth([MOD('a'), MOD('b'), MOD('c')]), 253);
  assert.equal(L.naturalWidth([]), L.SLOT_WIDTH, 'an empty slot is the house width');
  assert.equal(L.naturalWidth([MOD('wide', 400)]), 500, 'one item wider than the inside widens the slot');
});
