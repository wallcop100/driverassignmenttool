// core/layout.js holds no opinion about what is being arranged. These tests use
// a lighting control panel and its modules — never a hub or a driver — because
// if any hub assumption is still baked in, this is where it shows.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as L from '../../src/core/layout.js';

// a DIN module: 17.5mm wide, 90 tall. Nothing here is a driver.
const MOD = (ref, w = 17.5, h = 90) => ({ ref, label: ref, size: [w, h, 60] });
const PANEL = { ref: 'E41592', name: '#LCP5', contextType: 'Element' };

test('a container holds slots and a slot holds items — no hub anywhere', () => {
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
  assert.match(saved.container.parameters, /<1,2>$/);
  assert.equal(saved.container.contextType, 'Element', 'a panel is an Element');
  // every module is contexted into the panel, at a slot and a coordinate
  for (const e of saved.elements) {
    assert.equal(e.contextType, 'Element');
    assert.equal(e.contextRef, 'E41592');
    assert.match(e.contextParameters, /^\[.*\]<\d>$/);
  }

  const byRef = Object.fromEntries(slots.flat().map((i) => [i.ref, { ...i, rot: 0 }]));
  const back = L.load(saved, byRef, opts);
  assert.deepEqual(back.map((s) => s.map((i) => i.ref)), [['A', 'B'], ['C']]);
  assert.deepEqual(L.save(back, opts), saved, 'and saving it again is identical');
});

test('no wrapper type is invented when a caller does not name one', () => {
  // the hub has a generic enclosure; a panel may have nothing to split into
  const slots = [[MOD('A')], [MOD('B')]];
  const bare = L.save(slots, { container: PANEL, separate: [1] });
  assert.equal(bare.slots[0].typeRef, null, 'core never picks a type');
  const named = L.save(slots, { container: PANEL, separate: [1], wrapperType: 'ET-LCP-SUB' });
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
