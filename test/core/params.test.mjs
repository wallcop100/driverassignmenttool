// Parameter Syntax (page 100966) as the two tools share it. These assertions are
// about the syntax itself, not about anything a driver or a panel does with it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as p from '../../src/core/params.js';

test('each flavour is claimed by its brackets and the rest survives', () => {
  // ET-UNICA-8M-4K8, live: a size and a node list sharing one column
  const a = p.parseParams('[,,1U]{>ETH.01,>ETH.02,<SPK.01,>PWR.01}');
  assert.deepEqual(a.size, [null, null, 1]);
  assert.equal(a.nodes, '>ETH.01,>ETH.02,<SPK.01,>PWR.01');
  assert.equal(a.spaces, null);

  // ET-LCP5-Panel, live: a panel's slot recipe, no size at all
  const b = p.parseParams('<01,02,03,04,05,06,07,08,LB1,LB2,P1,P2,P3>');
  assert.equal(b.spaces, '01,02,03,04,05,06,07,08,LB1,LB2,P1,P2,P3');
  assert.equal(b.size, null);
  assert.equal(p.formatParams(b), '<01,02,03,04,05,06,07,08,LB1,LB2,P1,P2,P3>');

  // ET-PSU-ENC-T1/2-V1, live: an enclosure's slots
  assert.equal(p.parseParams('<1,2,3,4,5,6,7,8,A,B>').spaces, '1,2,3,4,5,6,7,8,A,B');
});

test('a size written in leaves a node recipe exactly as it was', () => {
  // the merge the patch depends on, from either tool
  assert.equal(p.withSize('{<OP.1,<OP.2}', [80, 30, 150]), '[80mm,30mm,150mm]{<OP.1,<OP.2}');
  assert.equal(p.withSize('{<A(DL1),>NET}', [17.5, 90, 60]), '[17.5mm,90mm,60mm]{<A(DL1),>NET}');
  assert.equal(p.parseParams(p.withSize('{<A(DL1),>NET}', [17.5, 90, 60])).nodes, '<A(DL1),>NET');
});

test('capacity is told apart from size by its double bracket', () => {
  const x = p.parseParams('[[380mm,1385mm,150mm]][210mm,40mm,]');
  assert.deepEqual(x.capacity, [380, 1385, 150]);
  assert.deepEqual(x.size, [210, 40, null]);
});

test('units are read, and a bare number is millimetres', () => {
  assert.equal(p.mm('600mm'), 600);
  assert.equal(p.mm('0.6m'), 600);
  assert.equal(p.mm('60cm'), 600);
  assert.equal(p.mm('600'), 600);
  assert.equal(p.mm(''), null);
  assert.equal(p.mm(null), null);
});

test('a missing axis stays missing rather than becoming zero', () => {
  // the schema treats an omitted coordinate and a zero differently
  assert.deepEqual(p.parseParams('[,50,]').size, [null, 50, null]);
  assert.equal(p.formatParams({ size: [null, 50, null] }), '[,50mm,]');
});
