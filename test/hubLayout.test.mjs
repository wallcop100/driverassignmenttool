// The geometry and the edits behind the hub layout lab. Pure module, so this
// runs under plain `node --test` with no DOM.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as hl from '../src/hubLayout.js';

const I = (ref, w = 210, h = 40) => ({ ref, label: ref, size: [w, h, 150] });

test('a Parameters field carrying several flavours survives a round trip', () => {
  // ET-UNICA-8M-4K8, live: a size and a node list sharing one column
  const p = hl.parseParams('[,,1U]{>ETH.01,>ETH.02,<SPK.01,>PWR.01}');
  assert.deepEqual(p.size, [null, null, 1]);
  assert.equal(p.nodes, '>ETH.01,>ETH.02,<SPK.01,>PWR.01');

  // writing a size in leaves the nodes exactly as they were
  const withSize = hl.withSize('{<OP.1,<OP.2}', [80, 30, 150]);
  assert.equal(withSize, '[80mm,30mm,150mm]{<OP.1,<OP.2}');
  assert.equal(hl.parseParams(withSize).nodes, '<OP.1,<OP.2');
});

test('capacity is told apart from size by its double bracket', () => {
  const p = hl.parseParams('[[380mm,1385mm,150mm]]');
  assert.deepEqual(p.capacity, [380, 1385, 150]);
  assert.equal(p.size, null);
  assert.equal(hl.formatParams(p), '[[380mm,1385mm,150mm]]');
});

test('units are read and a bare number is millimetres', () => {
  assert.equal(hl.mm('600mm'), 600);
  assert.equal(hl.mm('0.6m'), 600);
  assert.equal(hl.mm('60cm'), 600);
  assert.equal(hl.mm('600'), 600);
  assert.equal(hl.mm(''), null);
});

test('two wide parts cannot share a row, so they stack their clearance apart', () => {
  const placed = hl.placements([[I('A'), I('B')]]);
  assert.deepEqual(placed.map((p) => [p.ref, p.x, p.y]), [['A', 50, 25], ['B', 50, 115]]);
  // 25 above and below each, so 50 of air between the two bodies
  assert.equal(placed[1].y - (placed[0].y + 40), 50);
});

test('the cabinet is as wide as its bays, not as wide as its contents', () => {
  // HUB-A holds a 210mm SoloDrive and is drawn 380 wide
  assert.deepEqual(hl.extent([[I('A')]]), { w: 380, h: 90 });
  // two joined bays share their 50mm centre
  assert.equal(hl.extent([[I('A')], [I('B')]]).w, 710);
  // and the joiner's own width wins when one is given
  assert.equal(hl.extent([[I('A')], [I('B')]], { width: 530 }).w, 530);
});

test('splitting is between bays: a different piece of joinery, the same hub', () => {
  const bays = [[I('A'), I('B'), I('C')]];
  const out = hl.splitToBay(bays, ['C']);
  assert.deepEqual(out.map((b) => b.map((i) => i.ref)), [['A', 'B'], ['C']]);
  assert.deepEqual(out.map((b) => hl.bayHeight(b)), [180, 90]);
  assert.equal(hl.extent(out).h, 180, 'the hub is as tall as its tallest bay');
});

test('dragging reorders, and a dropped block takes a place rather than a position', () => {
  const bays = [[I('A'), I('B'), I('C')]];
  // a drop low in the bay lands at the bottom of the order, high lands at the top
  assert.equal(hl.dropIndex(bays[0], 0), 0);
  assert.equal(hl.dropIndex(bays[0], 1000), 3);
  assert.equal(hl.dropIndex(bays[0], 100), 1);

  const moved = hl.moveItem(bays, 'C', 0, 0);
  assert.deepEqual(moved[0].map((i) => i.ref), ['C', 'A', 'B']);
  // nothing can overlap, because nothing is positioned
  const ys = hl.placements(moved).map((p) => p.y);
  assert.deepEqual(ys, [...ys].sort((a, b) => a - b));
});

test('a bay removed tips its contents into the one before it', () => {
  const bays = [[I('A')], [I('B'), I('C')]];
  assert.deepEqual(hl.removeBay(bays).map((b) => b.map((i) => i.ref)), [['A', 'B', 'C']]);
  assert.equal(hl.removeBay([[I('A')]]).length, 1, 'the last bay stays');
  assert.deepEqual(hl.addBay(bays).length, 3);
});

test('rebalance spreads what is there across the bays it has', () => {
  const bays = [[I('A'), I('B'), I('C'), I('D')], []];
  assert.deepEqual(hl.rebalance(bays).map((b) => b.map((i) => i.ref)), [['A', 'B'], ['C', 'D']]);
});

test('fitsIn says by how much, so rearranging can be judged', () => {
  assert.equal(hl.fitsIn({ w: 380, h: 320 }, { w: 380, h: 300 }).fits, false);
  assert.equal(hl.fitsIn({ w: 380, h: 320 }, { w: 380, h: 300 }).overH, 20);
  assert.equal(hl.fitsIn({ w: 380, h: 300 }, { w: 380, h: 300 }).fits, true);
  assert.equal(hl.fitsIn({ w: 380, h: 320 }, { w: 380, h: 543 }).overH, -223, 'negative is spare');
});

test('feed provision is part of the hub, and sits at the bottom', () => {
  const feed = hl.feedItem();
  const placed = hl.placements([[feed, I('A')]]);
  assert.equal(placed[0].ref, '__feed');
  assert.ok(placed[0].y < placed[1].y);
});

test('a module is composed the way the drawings compose it', () => {
  // PSU across the top, driver bottom left, junction boxes stacked bottom right
  const m = hl.composite([
    { kind: 'psu', label: 'Meanwell HLG-185-24', size: [228, 68, 39] },
    { kind: 'driver', label: 'EldoLED 220D', size: [153, 50, 23] },
    { kind: 'jbox', label: 'JUNCTION BOX', size: [80, 35, 40] },
    { kind: 'jbox', label: 'JUNCTION BOX', size: [80, 35, 40] },
  ]);
  assert.deepEqual(m.size.slice(0, 2), [238, 143]);
  const by = Object.fromEntries(m.parts.map((p) => [p.label, p.at]));
  assert.deepEqual(by['EldoLED 220D'], [0, 0], 'driver bottom left');
  assert.equal(by['Meanwell HLG-185-24'][1], 75, 'PSU above the lower row');
  assert.equal(by['JUNCTION BOX'][0], 158, 'boxes to the right of the driver');

  // a driver on its own is still just its rectangle
  const solo = hl.composite([{ kind: 'driver', label: 'SL0360A', size: [210, 40, 33.5] }]);
  assert.deepEqual(solo.size.slice(0, 2), [210, 40]);
  assert.equal(solo.parts.length, 1);
});

test('the clearance envelope is 50 to the sides and 25 above and below', () => {
  // dimensioned against a lone SL0360A in the CAD
  assert.equal(hl.CLEAR_X, 50);
  assert.equal(hl.CLEAR_Y, 25);
  assert.deepEqual(hl.footprint(I('A', 210, 40)), { w: 310, h: 90 });
});

test('an item can be stood on its side, and takes its clearance with it', () => {
  const up = I('A', 210, 40);
  assert.deepEqual(hl.sized(up), [210, 40, 150]);
  assert.deepEqual(hl.sized({ ...up, rot: 90 }), [40, 210, 150]);
  // the clearance turns with the part: 50 off its sides, which are now its ends
  assert.deepEqual(hl.footprint({ ...up, rot: 90 }), { w: 90, h: 310 });
  assert.deepEqual(hl.clearOf(up), { x: 50, y: 25 });
  assert.deepEqual(hl.clearOf({ ...up, rot: 90 }), { x: 25, y: 50 });
  // and rotate toggles it back
  const bays = hl.rotate([[up]], 'A');
  assert.equal(bays[0][0].rot, 90);
  assert.equal(hl.rotate(bays, 'A')[0][0].rot, 0);
  // placements report the turned size, so the drawing and the patch agree
  assert.deepEqual(hl.placements(bays)[0].size, [40, 210, 150]);
});

test('a separate bay is its own sheet, the way H1 and H2 are two drawings', () => {
  assert.deepEqual(hl.sheets(3, [2]), [
    { slots: [0, 1], separate: false },
    { slots: [2], separate: true },
  ]);
  // every bay separate means a sheet each and nothing shared
  assert.deepEqual(hl.sheets(2, [0, 1]), [
    { slots: [0], separate: true },
    { slots: [1], separate: true },
  ]);
  assert.deepEqual(hl.sheets(2, []), [{ slots: [0, 1], separate: false }]);
});

test('joined bays share their centre; separate ones keep their own clearance', () => {
  const two = [[I('A')], [I('B')]];
  // 380 + 380 less the 50 they share
  assert.equal(hl.extent(two).w, 710);
  assert.equal(hl.extent(two, { joined: false }).w, 760);
  // the content areas abut with exactly 50 between them
  const p = hl.placements(two);
  const bay0ContentEnds = hl.CLEAR_X + (hl.BAY_WIDTH - hl.CLEAR_X * 2);
  assert.equal(p[1].x - bay0ContentEnds, 50);
  assert.equal(hl.pitchOf(380), 330);
  assert.equal(hl.pitchOf(380, false), 380);
});

test('the trunking is the side clearance, not a wall on top of it', () => {
  // counting both made every hub 50mm too wide per bay
  assert.equal(hl.TRUNK, hl.CLEAR_X);
  assert.equal(hl.BAY_WIDTH - hl.TRUNK * 2, 280, 'a 380 bay has 280 of usable width');
  // and everything clears the trunking whichever way it faces, because the
  // band is there regardless
  // upright, the 50 is at the part's ends, so the row is inset by it and the
  // trunking stands in the inset. Turned, the 50 is above and below instead, so
  // the row has the whole bay width - HUB-A runs four turned drivers wall to wall
  // over a 280 column of upright ones.
  const both = hl.placements([[I('A'), { ...I('B'), rot: 90 }]]);
  assert.equal(both[0].x, hl.TRUNK);
  assert.equal(both[1].x, 0);
});

test('a part narrow enough sits beside its neighbour, not above it', () => {
  // four turned SoloDrives make one row across the top of HUB-A; a pure stack
  // drew them as four rows and made the hub four times too tall
  const four = [0, 1, 2, 3].map((n) => ({ ...I(`D${n}`, 210, 40), rot: 90 }));
  const p = hl.placements([four]);
  assert.deepEqual(p.map((i) => i.y), [50, 50, 50, 50], 'all on one row');
  // turned, each is 40 wide and brings 25 to its long sides, shared with its
  // neighbour, and the row starts at the wall because its 50 is above and below
  assert.deepEqual(p.map((i) => i.x), [0, 65, 130, 195]);
  assert.equal(hl.bayHeight(four), 310, '210 body plus the 50 above and below');
});

test('a row closes when the next part will not fit the width', () => {
  // 40 wide plus a shared 25: five need 425 and a 380 bay takes six less than that
  const many = [0, 1, 2, 3, 4, 5, 6].map((n) => ({ ...I(`D${n}`, 210, 40), rot: 90 }));
  const rows = hl.packBay(many);
  assert.deepEqual(rows.map((r) => r.at.length), [6, 1]);
  assert.deepEqual(rows.map((r) => r.hatched), [true, true], 'turned rows hatch their ends');
});

// ---- saving a layout to Parameters and getting the same drawing back -------
// Every edit the lab offers has to survive the DesignDB. The check is always
// the same: make the edit, save, load, and assert the drawing is identical - 
// not just the item list, the actual placements the renderer consumes.

const byRef = (bays) => Object.fromEntries(
  bays.flat().map((i) => [i.ref, { ...i, rot: 0 }]));

// the drawing, as the renderer sees it: every part, where it is and how big
const drawing = (bays, opts) => ({
  extent: hl.extent(bays, opts),
  parts: hl.placements(bays, opts)
    .map((p) => [p.ref, p.bay, p.x, p.y, p.size[0], p.size[1], p.rot ?? 0]),
});

// save -> load -> the same drawing, and the same again on a second pass
function roundTrip(bays, opts = {}) {
  const _ = 0;
  const saved = hl.save(bays, opts);
  const back = hl.load(saved, byRef(bays));
  assert.deepEqual(drawing(back, opts), drawing(bays, opts));
  // idempotent: saving what was loaded gives byte-identical Parameters
  assert.deepEqual(hl.save(back, opts), saved);
  return { saved, back };
}

const HUB = () => [[I('A'), I('B', 153.6, 76.7), I('C', 153.6, 76.7)]];

test('save/load: an untouched hub', () => {
  const { saved } = roundTrip(HUB());
  // 210x40 takes a row of 90, the two 153.6x76.7 are too wide to share one so
  // they take 126.7 each: 343 tall in a 380 bay
  assert.equal(saved.container.parameters, '[[380mm,343mm,150mm]]<1>');
  // the coordinate is relative to the hub the Element is contexted into, and the
  // bay is the discrete space it sits in - both, as page 100966 has them
  assert.equal(saved.elements[0].contextParameters, '[50mm,25mm,0mm]<1>');
  assert.equal(saved.elements[0].parameters, null, 'upright says nothing its type does not');
});

test('save/load: moving a part within a bay', () => {
  const bays = HUB();
  const moved = hl.moveItem(bays, 'C', 0, 0);
  const { saved } = roundTrip(moved);
  // C is at the bottom now, so it is the one sitting on the floor
  assert.equal(saved.elements[0].ref, 'C');
  assert.match(saved.elements[0].contextParameters, /^\[50mm,25mm,0mm\]<1>$/);
});

test('save/load: moving a part to another bay writes a different discrete space', () => {
  const bays = hl.addBay(HUB());
  const moved = hl.moveItem(bays, 'B', 1, 0);
  const { saved } = roundTrip(moved);
  const b = saved.elements.find((e) => e.ref === 'B');
  assert.match(b.contextParameters, /<2>$/, 'bay 2');
  // bay 2 starts a shared centre along: 380 - 50 + 50
  assert.match(b.contextParameters, /^\[380mm,/);
  assert.match(saved.container.parameters, /<1,2>$/, 'the hub declares both bays');
});

test('save/load: rotation, the one thing the syntax has no field for', () => {
  const bays = hl.rotate(HUB(), 'B');
  const { saved, back } = roundTrip(bays);
  const b = saved.elements.find((e) => e.ref === 'B');
  // the documented escape hatch: the Element overrides its type with the
  // as-placed size, which is the type's swapped
  assert.equal(b.parameters, '[76.7mm,153.6mm,150mm]');
  assert.equal(back[0].find((i) => i.ref === 'B').rot, 90);
  // and the part that was not turned still says nothing
  assert.equal(saved.elements.find((e) => e.ref === 'A').parameters, null);
});

test('save/load: a turned part is not confused with a genuinely square one', () => {
  // a part whose type IS its own swap must not read back as turned
  const bays = [[{ ref: 'SQ', label: 'SQ', size: [100, 100, 150] }]];
  const { saved, back } = roundTrip(bays);
  assert.equal(saved.elements[0].parameters, null);
  assert.equal(back[0][0].rot, 0);
});

test('save/load: splitting into a new bay', () => {
  const { saved } = roundTrip(hl.splitToBay(HUB(), ['C']));
  assert.match(saved.container.parameters, /<1,2>$/);
  assert.match(saved.elements.find((e) => e.ref === 'C').contextParameters, /<2>$/);
});

test('save/load: adding and removing a bay', () => {
  const three = hl.addBay(hl.addBay(HUB()));
  roundTrip(three);
  assert.match(hl.save(three).container.parameters, /<1,2,3>$/);
  const back = hl.removeBay(three, 2);
  const { saved } = roundTrip(back);
  assert.match(saved.container.parameters, /<1,2>$/);
});

test('save/load: a wider bay is recorded in the capacity, not lost', () => {
  const opts = { slotWidth: 500 };
  const { saved } = roundTrip(HUB(), opts);
  assert.match(saved.container.parameters, /^\[\[500mm,/);
});

test('save/load: two joined bays keep their shared centre', () => {
  const bays = hl.addBay(HUB());
  const moved = hl.moveItem(bays, 'C', 1, 0);
  const { saved } = roundTrip(moved, { slotWidth: 380, joined: true });
  // 380 + 380 less the 50 they share
  assert.match(saved.container.parameters, /^\[\[710mm,/);
});

test('save/load: several edits in a row, then one save', () => {
  // the C1 case from the drawings: rearranged until it got shorter
  let bays = hl.addBay(HUB());
  bays = hl.moveItem(bays, 'C', 1, 0);
  bays = hl.rotate(bays, 'B');
  bays = hl.moveItem(bays, 'B', 1, 0);
  bays = hl.rotate(bays, 'A');
  const { back } = roundTrip(bays);
  assert.deepEqual(back.map((b) => b.map((i) => i.ref)), bays.map((b) => b.map((i) => i.ref)));
});

test('save/load: a part whose type gained a size is not re-read as turned', () => {
  // the Element carries no size of its own, so the type's is authoritative
  const bays = HUB();
  const saved = hl.save(bays);
  const back = hl.load(saved, byRef(bays));
  assert.deepEqual(back.flat().map((i) => i.rot), [0, 0, 0]);
});

test('save/load: the saved fields are legal Parameter Syntax', () => {
  const bays = hl.rotate(hl.addBay(HUB()), 'B');
  const { saved } = roundTrip(bays);
  // every field re-parses to exactly what was written
  assert.equal(hl.formatParams(hl.parseParams(saved.container.parameters)), saved.container.parameters);
  for (const e of saved.elements) {
    assert.equal(hl.formatParams(hl.parseParams(e.contextParameters)), e.contextParameters);
    if (e.parameters) assert.equal(hl.formatParams(hl.parseParams(e.parameters)), e.parameters);
  }
});

test('save/load: a size written beside a node list leaves the nodes alone', () => {
  // an Element that is turned AND has its own node recipe: the patch merges
  const existing = '{<OP.1,<OP.2}';
  const turned = hl.withSize(existing, [76.7, 153.6, 150]);
  assert.equal(turned, '[76.7mm,153.6mm,150mm]{<OP.1,<OP.2}');
  assert.equal(hl.parseParams(turned).nodes, '<OP.1,<OP.2');
});

test('load: Parameters typed by hand in the workbook, not written by save()', () => {
  // the real risk in a symmetric round trip is that it only ever decodes its own
  // output. This is the drawing as somebody would key it into the sheet.
  const parts = {
    SOLO: { ref: 'SOLO', label: 'SL0360A', size: [210, 40, 33.5] },
    DUAL: { ref: 'DUAL', label: 'DL0560A3', size: [153.6, 76.7, 30.6] },
    PSU: { ref: 'PSU', label: 'HLG-185-24', size: [228, 68, 38.8] },
  };
  const bays = hl.load({
    container: '[[710mm,400mm,150mm]]<1,2>',
    elements: [
      { ref: 'PSU', contextParameters: '[50mm,25mm,]<1>', parameters: null },
      { ref: 'SOLO', contextParameters: '[50mm,143mm,]<1>', parameters: null },
      // turned: its own size, its type's swapped
      { ref: 'DUAL', contextParameters: '[380mm,50mm,]<2>', parameters: '[76.7mm,153.6mm,30.6mm]' },
    ],
  }, parts);

  assert.deepEqual(bays.map((b) => b.map((i) => i.ref)), [['PSU', 'SOLO'], ['DUAL']]);
  assert.equal(bays[1][0].rot, 90, 'read back as turned from its own size alone');
  // and it draws: the turned part is 76.7 wide and starts at the wall of bay 2
  const p = hl.placements(bays);
  const dual = p.find((i) => i.ref === 'DUAL');
  assert.deepEqual(dual.size.slice(0, 2), [76.7, 153.6]);
  assert.equal(dual.x, hl.pitchOf(hl.BAY_WIDTH), 'turned rows start at the wall');
});

test('load: a missing size axis and a missing bay both fall back rather than throw', () => {
  const parts = { A: { ref: 'A', label: 'A', size: [210, 40, 150] } };
  const bays = hl.load({
    container: '[[380mm,,]]',                         // no bay list at all
    elements: [{ ref: 'A', contextParameters: '[,,]', parameters: null }],
  }, parts);
  assert.equal(bays.length, 1);
  assert.deepEqual(bays[0].map((i) => i.ref), ['A']);
});

test('load: an Element the model no longer has is dropped, not drawn as a hole', () => {
  const parts = { A: { ref: 'A', label: 'A', size: [210, 40, 150] } };
  const bays = hl.load({
    container: '[[380mm,90mm,150mm]]<1>',
    elements: [
      { ref: 'A', contextParameters: '[50mm,25mm,]<1>', parameters: null },
      { ref: 'GONE', contextParameters: '[50mm,115mm,]<1>', parameters: null },
    ],
  }, parts);
  assert.deepEqual(bays[0].map((i) => i.ref), ['A']);
});

// ---- a hub is not necessarily an Element ----------------------------------
// On the live projects a PSU hub is usually a Position - P8110, labelled CSB - 
// but it can be an Element, and page 100966 puts available continuous space on
// "Locations/Positions/Elements and Types". Getting the kind wrong writes the
// capacity to a sheet the hub is not on and contexts every driver into a row
// that does not exist, so it is carried rather than assumed.

test('the hub kind is carried through to every driver contexted into it', () => {
  for (const kind of ['Position', 'Element', 'Location']) {
    const saved = hl.save(HUB(), { container: { ref: 'P8110', contextType: kind } });
    assert.equal(saved.container.contextType, kind);
    assert.equal(saved.container.ref, 'P8110');
    for (const e of saved.elements) {
      assert.equal(e.contextType, kind, 'the driver is contexted INTO the hub');
      assert.equal(e.contextRef, 'P8110');
    }
  }
});

test('the same arrangement on a Position and on an Element differ only in kind', () => {
  const bays = hl.rotate(hl.addBay(HUB()), 'B');
  const asPos = hl.save(bays, { container: { ref: 'P8110', contextType: 'Position' } });
  const asEl = hl.save(bays, { container: { ref: 'E80023', contextType: 'Element' } });
  assert.equal(asPos.container.parameters, asEl.container.parameters, 'the geometry is the geometry');
  assert.deepEqual(
    asPos.elements.map((e) => e.contextParameters),
    asEl.elements.map((e) => e.contextParameters),
  );
  // and both load back to the same drawing
  const refs = byRef(bays);
  assert.deepEqual(drawing(hl.load(asPos, refs)), drawing(hl.load(asEl, refs)));
});

test('an unknown hub kind is refused rather than defaulted to Element', () => {
  assert.throws(() => hl.save(HUB(), { container: { ref: 'X', contextType: 'Rack' } }),
    /Location\/Position\/Element/);
  // case is forgiving, the value is not
  assert.equal(hl.contextType({ contextType: 'position' }), 'Position');
  assert.equal(hl.contextType({ kind: 'element' }), 'Element');
});

test('no hub given means no kind claimed, not a guess', () => {
  const saved = hl.save(HUB());
  assert.equal(saved.container.contextType, null);
  assert.equal(saved.container.ref, null);
  assert.equal(saved.elements[0].contextType, null);
  // and it still round trips - the geometry never depended on the kind
  roundTrip(HUB());
});

// ---- a separated bay becomes its own enclosure Element ---------------------
// Measured on set 108908: 218 hub Positions carry ONE ET-PSU-ENC-*
// Element and 27 carry TWO, named #72.1 and #72.2 under hub #72, with the
// drivers contexted into the enclosure rather than the hub. Three other live
// sets put every driver straight on the hub Position. Both are correct; which
// one applies is whether the bay stands alone.

const POS = { ref: 'P90001', name: '#72', contextType: 'Position' };

test('joined bays keep every driver on the hub Position', () => {
  const bays = hl.addBay(HUB());
  const saved = hl.save(bays, { container: POS });
  assert.deepEqual(saved.slots, [], 'no enclosure Element is invented');
  assert.match(saved.container.parameters, /<1,2>$/, 'the hub holds both bays itself');
  for (const e of saved.elements) {
    assert.equal(e.contextType, 'Position');
    assert.equal(e.contextRef, 'P90001');
  }
});

test('separating a bay makes it an enclosure Element named the way set 108908 names it', () => {
  const bays = hl.addBay(HUB());
  const moved = hl.moveItem(bays, 'C', 1, 0);
  const saved = hl.save(moved, { container: POS, separate: [1] });

  assert.equal(saved.slots.length, 1);
  const enc = saved.slots[0];
  assert.equal(enc.name, '#72.2', 'hub name, dot, bay number - as #72.2 under #72');
  assert.equal(enc.contextType, 'Position', 'the enclosure sits on the hub Position');
  assert.equal(enc.contextRef, 'P90001');
  assert.equal(enc.isNew, true, 'its Ref is the workbook\'s to allocate');
  assert.match(enc.parameters, /^\[\[380mm,/, 'and it states its own size');

  assert.equal(enc.typeRef, hl.ENCLOSURE_TYPE, 'one generic wrapper type, not a size catalogue');
  // the hub now states only the bay it still holds itself - bay 2's size went
  // with bay 2, so the hub is a single 380 bay again, not the 710 it was
  assert.match(saved.container.parameters, /<1>$/);
  assert.match(saved.container.parameters, /^\[\[380mm,/);
  assert.equal(saved.container.clear, false);
});

test('a driver in a separated bay is contexted into the bay, not the hub', () => {
  const bays = hl.moveItem(hl.addBay(HUB()), 'C', 1, 0);
  const saved = hl.save(bays, { container: POS, separate: [1], wrapperRefs: { 1: 'E90215' } });

  const c = saved.elements.find((e) => e.ref === 'C');
  assert.equal(c.contextType, 'Element');
  assert.equal(c.contextRef, 'E90215');
  // and its coordinate is relative to the bay it is now in, not to the hub
  // local to the bay: the 50 trunking inset still applies inside it, but the
  // bay's own offset across the hub (a 330 pitch) is gone
  assert.match(c.contextParameters, /^\[50mm,/);
  assert.equal(hl.save(bays, { container: POS }).elements.find((e) => e.ref === 'C')
    .contextParameters.startsWith('[380mm,'), true, 'unseparated it is 380 from the hub');
  assert.doesNotMatch(c.contextParameters, /<\d/, 'the parent already says which bay');

  // the others are untouched and still on the Position
  for (const e of saved.elements.filter((x) => x.ref !== 'C')) {
    assert.equal(e.contextType, 'Position');
    assert.equal(e.contextRef, 'P90001');
  }
});

test('a separated bay round trips back to the same drawing', () => {
  const bays = hl.moveItem(hl.addBay(HUB()), 'C', 1, 0);
  const opts = { container: POS, separate: [1], wrapperRefs: { 1: 'E90215' } };
  const saved = hl.save(bays, opts);
  const back = hl.load(saved, byRef(bays), opts);
  assert.deepEqual(drawing(back, opts), drawing(bays, opts));
  assert.deepEqual(hl.save(back, opts), saved, 'and saving it again is identical');
});

test('every bay separated: each is its own enclosure, the hub holds none directly', () => {
  const bays = hl.moveItem(hl.addBay(HUB()), 'C', 1, 0);
  const opts = { container: POS, separate: [0, 1], wrapperRefs: { 0: 'E90214', 1: 'E90215' } };
  const saved = hl.save(bays, opts);

  assert.deepEqual(saved.slots.map((b) => b.name), ['#72.1', '#72.2']);
  // the parameters followed the bays out, so the Position states nothing - and
  // says so loudly, because whatever is on that row has to be cleared
  assert.equal(saved.container.parameters, '');
  assert.equal(saved.container.clear, true);
  assert.deepEqual([...new Set(saved.elements.map((e) => e.contextType))], ['Element']);
  assert.deepEqual(drawing(hl.load(saved, byRef(bays), opts), opts), drawing(bays, opts));
});

test('joining a separated bay back puts its drivers on the Position again', () => {
  const bays = hl.moveItem(hl.addBay(HUB()), 'C', 1, 0);
  const split = hl.save(bays, { container: POS, separate: [1], wrapperRefs: { 1: 'E90215' } });
  const joined = hl.save(bays, { container: POS, separate: [] });

  assert.equal(split.elements.find((e) => e.ref === 'C').contextType, 'Element');
  assert.equal(joined.elements.find((e) => e.ref === 'C').contextType, 'Position');
  assert.deepEqual(joined.slots, [], 'the enclosure Element is no longer needed');
  // the drawing is the same either way - separating is a record, not a move
  assert.deepEqual(drawing(bays), drawing(bays));
});

test('two separated bays may come out different sizes, as #71.1 and #71.2 do', () => {
  // one bay holds the tall stack, the other a single part
  const bays = [[I('A'), I('B', 153.6, 76.7)], [I('C', 153.6, 76.7)]];
  const saved = hl.save(bays, { container: POS, separate: [0, 1] });
  const [h1, h2] = saved.slots.map((b) => hl.parseParams(b.parameters).capacity[1]);
  assert.ok(h1 > h2, 'each enclosure states its own height');
  assert.equal(h2, hl.bayHeight(bays[1]));
});

test('splitting takes the parameters OFF the Position, it does not copy them', () => {
  const bays = hl.moveItem(hl.addBay(HUB()), 'C', 1, 0);

  // before: the Position states the whole hub, both bays
  const joined = hl.save(bays, { container: POS });
  assert.match(joined.container.parameters, /^\[\[710mm,.*<1,2>$/);
  assert.equal(joined.container.clear, false);

  // one bay out: the Position keeps only what it still holds
  const one = hl.save(bays, { container: POS, separate: [1] });
  assert.match(one.container.parameters, /<1>$/);
  assert.doesNotMatch(one.container.parameters, /<1,2>/, 'bay 2 is no longer the hub\'s to state');
  const encH = hl.parseParams(one.slots[0].parameters).capacity[1];
  assert.equal(encH, hl.bayHeight(bays[1]), 'bay 2\'s size went with bay 2');

  // both out: nothing left, and the row must be cleared rather than left stale
  const all = hl.save(bays, { container: POS, separate: [0, 1] });
  assert.equal(all.container.parameters, '');
  assert.equal(all.container.clear, true);
  // nobody states a size twice
  const claimed = [all.container.parameters, ...all.slots.map((b) => b.parameters)]
    .filter((x) => hl.parseParams(x).capacity);
  assert.equal(claimed.length, 2, 'one claim per bay, none from the hub');
});

test('a hub left at Position level is not wrapped just because it could be', () => {
  // 218 set 108908 hubs carry a single enclosure, but three other live sets carry
  // none at all. Unsplit, the lower-impact shape wins: leave it as it is.
  for (const bays of [HUB(), hl.addBay(HUB())]) {
    const saved = hl.save(bays, { container: POS });
    assert.deepEqual(saved.slots, []);
    assert.equal(saved.container.clear, false);
    assert.ok(saved.elements.every((e) => e.contextType === 'Position'));
  }
});

test('the enclosure type is one generic wrapper, overridable', () => {
  const bays = hl.addBay(HUB());
  assert.equal(hl.save(bays, { container: POS, separate: [1] }).slots[0].typeRef, 'ET-PSU-ENC');
  assert.equal(
    hl.save(bays, { container: POS, separate: [1], wrapperType: 'ET-ENCLOSURE-INT-01' }).slots[0].typeRef,
    'ET-ENCLOSURE-INT-01',
  );
});
