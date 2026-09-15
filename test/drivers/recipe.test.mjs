// A module's parts and where they sit, from what the DB can hold.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as r from '../../src/drivers/recipe.js';
import { dragTo, nudge, stepOf } from '../../src/core/snap.js';

const types = {
  'ET-CVR-01': { name: 'EldoLED LinearDrive 220D', params: '[153mm,50mm,23mm]{<OP.1,<OP.2}' },
  'ET-CVR-PSU-24': { name: 'Meanwell - HLG-185-24', params: '[228mm,68mm,39mm]', outputVoltageV: 24 },
};
const wrapper = { typeRef: 'ET-CVR-D-24-2CH-01', name: 'EldoLED - LinearDrive 220D, Meanwell - HLG-185-24', params: '{<OP.1,<OP.2}' };
const children = [{ typeRef: 'ET-CVR-01', quantity: 1 }, { typeRef: 'ET-CVR-PSU-24', quantity: 1 }];

test('the role comes from what a type states before what its name suggests', () => {
  assert.deepEqual(r.roleOf({ params: '{<OP.1,<OP.2}' }), { role: 'Driver', origin: 'db' });
  assert.deepEqual(r.roleOf({ params: '', outputVoltageV: 24 }), { role: 'PSU', origin: 'db' });
  assert.deepEqual(r.roleOf({ params: '' }, { kind: 'supply' }), { role: 'PSU', origin: 'datasheet' });
  assert.deepEqual(r.roleOf({ params: '', typeRef: 'ET-EM-03' }), { role: 'EM', origin: 'datasheet' });
  assert.equal(r.roleOf({ params: '' }).role, null);
});

test('DB children are laid out by the house rule: supply across the top', () => {
  const { source, parts } = r.partsFor({ wrapper, children, types });
  assert.equal(source, 'children');
  const psu = parts.find((p) => p.role === 'PSU');
  const drv = parts.find((p) => p.role === 'Driver');
  assert.deepEqual(drv.at, [0, 0, 0]);
  assert.deepEqual(psu.at, [0, 55, 0], 'above the 50mm driver with a 5mm gap');
  assert.equal(drv.sizeOrigin, 'db');
  assert.deepEqual(r.envelope(parts), [228, 123, 39]);
});

test('the wrapper type states its parts, and they come back exactly', () => {
  const { parts } = r.partsFor({ wrapper, children, types });
  const moved = parts.map((p) => (p.role === 'PSU' ? { ...p, at: [10, 60, 0] } : p));
  const params = r.wrapperParams(wrapper.params, moved);
  assert.equal(params,
    '[238mm,128mm,39mm]<Driver(ET-CVR-01)[153mm,50mm,23mm,0,0,0],PSU(ET-CVR-PSU-24)[228mm,68mm,39mm,10mm,60mm,0]>{<OP.1,<OP.2}');
  const back = r.partsFor({ wrapper: { ...wrapper, params }, children, types });
  assert.equal(back.source, 'spaces', 'stated spaces beat the children');
  assert.deepEqual(back.parts.map((p) => [p.space, p.role, p.typeRef, p.size, p.at]),
    [['Driver', 'Driver', 'ET-CVR-01', [153, 50, 23], [0, 0, 0]], ['PSU', 'PSU', 'ET-CVR-PSU-24', [228, 68, 39], [10, 60, 0]]]);
});

test('with no children and no spaces the datasheet pair is only a suggestion', () => {
  const spec = { driver: { code: 'EldoLED 220D', sizeMm: [153, 50, 23] }, supply: { code: 'Meanwell HLG-185-24', sizeMm: [228, 68, 39] } };
  const s = r.partsFor({ wrapper, resolveSpec: () => spec });
  assert.equal(s.source, 'suggested');
  assert.ok(s.parts.every((p) => p.sizeOrigin === 'datasheet' && p.typeRef === null));
  assert.equal(r.partsFor({ wrapper }).source, 'wrapper');
  const edited = [{ role: 'Driver', typeRef: 'X', size: [1, 1, 1], at: [0, 0, 0] }];
  assert.equal(r.partsFor({ wrapper, children, types, edited }).source, 'edited');
});

test('junction boxes are spaces on the driver Element, and their count comes back', () => {
  const { parts } = r.partsFor({ wrapper, children, types });
  const params = r.elementParams('[76.7mm,153.6mm,150mm]', 2, parts);
  // the supply sits at 55, so a second box beside the driver would reach it:
  // the stack goes right of everything instead
  assert.equal(params, '[76.7mm,153.6mm,150mm]<JB.1[80mm,35mm,40mm,233mm,0,0],JB.2[80mm,35mm,40mm,233mm,35mm,0]>',
    'beside the as-placed size it already held');
  assert.equal(r.jbCount(params), 2);
  assert.equal(r.jbCount('[76.7mm,153.6mm,150mm]'), null, 'nothing stated: the default stands');
  assert.equal(r.jbCount(r.elementParams(params, 0, parts)), null, 'zero writes none');
  const m = r.compose(parts, 2);
  assert.deepEqual(m.size, [313, 123, 40]);
  assert.equal(m.parts.filter((p) => p.kind === 'jbox').length, 2);
});

test('the snap: 5mm by default, Alt for 1mm, Shift for five steps, and a nudge lands on the grid', () => {
  assert.equal(stepOf(), 5);
  assert.equal(dragTo(338, 12, 5), 350);
  assert.equal(dragTo(338, 12, 5, { alt: true }), 350);
  assert.equal(dragTo(338, 13.4, 5, { alt: true }), 351);
  assert.equal(dragTo(338, 12, 5, { shift: true }), 350);
  assert.equal(dragTo(338, 40, 5, { shift: true }), 375);
  assert.equal(dragTo(338, -400, 5, {}, { min: 253 }), 253, 'never narrower than the contents');
  assert.equal(nudge(338, 1, 5), 340);
  assert.equal(nudge(340, 1, 5), 345);
  assert.equal(nudge(338, -1, 5), 335);
  assert.equal(nudge(340, 1, 5, { shift: true }), 350);
});

test('a junction box never sits on a part', () => {
  const low = [{ role: 'Driver', size: [153, 50, 23], at: [0, 0, 0] }, { role: 'PSU', size: [228, 68, 39], at: [0, 55, 0] }];
  const boxes = r.placeJbs(2, low);
  assert.equal(boxes[0].at[0], 233, 'the second box would reach the supply, so the stack moves right of everything');
  const lifted = r.houseArrange(low, { minLow: 70 });
  assert.deepEqual(lifted.find((p) => p.role === 'PSU').at, [0, 75, 0], 'or the house rule lifts the supply over the stack');
  assert.equal(r.placeJbs(2, lifted)[0].at[0], 158, 'and the boxes stay beside the driver');
  const m = r.compose(lifted, 2);
  const rects = m.parts;
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i]; const b = rects[j];
      const hit = a.at[0] < b.at[0] + b.size[0] && b.at[0] < a.at[0] + a.size[0] && a.at[1] < b.at[1] + b.size[1] && b.at[1] < a.at[1] + a.size[1];
      assert.ok(!hit, `${a.kind} and ${b.kind} overlap`);
    }
  }
});
