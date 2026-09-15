// The shared drawing idiom (DJ 101676 / page 139763). These are the decisions
// that used to be made inline in the hub lab and got them wrong.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as d from '../../src/core/draw.js';

test('a block is filled by what it is, and lettered to suit', () => {
  assert.equal(d.fillFor('processor'), '#00b050');
  assert.equal(d.fillFor('psu'), '#e8112d');
  assert.equal(d.fillFor('jbox'), '#d9dee3');
  assert.equal(d.fillFor('who knows'), '#ffffff', 'an unknown class is not a crash');
  assert.equal(d.inkFor('#00b050'), '#fff', 'white on a saturated fill');
  assert.equal(d.inkFor('#d9dee3'), '#111', 'near-black on a pale one');
});

test('a spare way is drawn, not skipped', () => {
  const s = d.spareStyle();
  assert.equal(s.fill, '#fff');
  assert.equal(s.stroke, '#c41f4b');
  assert.ok(s.dash, 'dashed, so it reads as an absence');
  assert.match(d.SPARE_LABEL, /DO NOT CONNECT/);
});

test('a label too narrow to read across is turned, not clipped', () => {
  // the 25mm Panduit case: a tall thin block
  const turned = d.labelPlan('Panduit', null, 20, 120);
  assert.equal(turned.mode, 'turned');
  // the same label in a wide block stays across
  const across = d.labelPlan('Panduit', null, 200, 40);
  assert.equal(across.mode, 'across');
  // and a block too small either way says so rather than spilling
  assert.equal(d.labelPlan('MOD-QSX-PROC-2', null, 12, 12).mode, 'none');
});

test('the second line is dropped before the name is', () => {
  const roomy = d.labelPlan('MOD-DALI', 'E41592 - 70mm', 200, 44);
  assert.equal(roomy.mode, 'across');
  assert.equal(roomy.sub, 'E41592 - 70mm');
  const tight = d.labelPlan('MOD-DALI', 'E41592 - 70mm', 200, 14);
  assert.equal(tight.mode, 'across', 'the name survives');
  assert.equal(tight.sub, null, 'the detail does not');
});

test('a label never exceeds the box it is drawn in', () => {
  for (const [w, h] of [[200, 40], [60, 200], [90, 30], [400, 60]]) {
    const p = d.labelPlan('EldoLED DL0560A3', 'E90214 - 153.6mm', w, h);
    if (p.mode === 'across') assert.ok(d.textWidth('EldoLED DL0560A3', p.size) <= w, `across ${w}x${h}`);
    if (p.mode === 'turned') assert.ok(d.textWidth('EldoLED DL0560A3', p.size) <= h, `turned ${w}x${h}`);
  }
});

test('the two scale policies stay apart', () => {
  // a hub elevation states a real size: 153.6mm is 153.6mm
  const real = d.scaler('true', 1);
  assert.equal(real(153.6), 153.6);
  assert.equal(real(17.5), 17.5);
  // a panel schematic clamps for legibility - 101676 says do not measure it
  const sch = d.scaler('schematic', 1);
  assert.equal(sch(17.5), d.SCHEMATIC_MIN, 'a 17.5mm DIN module stays readable');
  assert.equal(sch(900), d.SCHEMATIC_MAX, 'and a long one stays on the page');
  assert.equal(sch(120), 120, 'in between, it is itself');
});

test('the second line reads the way 101676 writes it', () => {
  assert.equal(d.subLabel('E41763', 105), 'E41763 - 105mm');
  assert.equal(d.subLabel('E41763', null), 'E41763');
  assert.equal(d.subLabel('E90214', 153.6), 'E90214 - 153.6mm');
});

test('bold lettering is measured wider, so it shrinks before it is clipped', () => {
  // MOD-DALI-LUTRON in a 112px panel block: fits regular, must not claim to fit bold
  const regular = d.labelPlan('MOD-DALI-LUTRON', null, 112, 56, { base: 12, min: 7 });
  const bold = d.labelPlan('MOD-DALI-LUTRON', null, 112, 56, { base: 12, min: 7, char: d.CHAR_BOLD });
  assert.ok(bold.mode !== 'across' || bold.size < regular.size || regular.mode !== 'across');
  if (bold.mode === 'across') {
    assert.ok(d.textWidth('MOD-DALI-LUTRON', bold.size, d.CHAR_BOLD) <= 112 - 8);
  }
});

test('a real measurement, when the page has one, replaces the estimate', () => {
  // a face twice as wide as the estimate: the plan must believe the measurement
  const wide = (text, size) => text.length * size * 1.2;
  const est = d.labelPlan('PROCESSOR-C', null, 110, 56, { base: 12, min: 7 });
  const real = d.labelPlan('PROCESSOR-C', null, 110, 56, { base: 12, min: 7, measure: wide });
  assert.equal(est.mode, 'across');
  assert.ok(real.mode !== 'across' || wide('PROCESSOR-C', real.size) <= 110 - 8,
    'across only at a size the measurement says fits');
});
