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

test('a space can carry a detail, its size and where it sits', () => {
  const x = p.parseParams('[[838mm,418mm,150mm]]<1[338mm,418mm,150mm,0,0,0],2[550mm,418mm,150mm,288mm,0,0]>');
  assert.deepEqual(x.capacity, [838, 418, 150]);
  assert.equal(x.size, null, 'a size inside a space is not the entity size');
  assert.deepEqual(x.spaceList.map((s) => [s.name, s.size, s.at]),
    [['1', [338, 418, 150], [0, 0, 0]], ['2', [550, 418, 150], [288, 0, 0]]]);
  assert.equal(p.formatParams(x), '[[838mm,418mm,150mm]]<1[338mm,418mm,150mm,0,0,0],2[550mm,418mm,150mm,288mm,0,0]>');

  const w = p.parseParams('[233mm,123mm,39mm]<PSU(ET-CVR-PSU-24)[228mm,68mm,39mm,0,55mm,0],Driver(ET-CVR-01)[153mm,50mm,23mm,0,0,0]>{<OP.1,<OP.2}');
  assert.deepEqual(w.size, [233, 123, 39]);
  assert.equal(w.nodes, '<OP.1,<OP.2');
  assert.deepEqual(w.spaceList.map((s) => [s.name, s.detail, s.at]),
    [['PSU', 'ET-CVR-PSU-24', [0, 55, 0]], ['Driver', 'ET-CVR-01', [0, 0, 0]]]);
});

test('the rewrite page examples read as they say', () => {
  const r = p.parseSpace('Rack Rear.Top[100%,40mm,50%,0,760mm,50%][[100%,100%,20U,0,0,0]]');
  assert.equal(r.name, 'Rack Rear.Top');
  assert.deepEqual(r.at, [0, 760, 50]);
  assert.ok(r.capacity);
  const t = p.parseParams('[20m,20m,20m][[10m,10m,10m,10m,2m,0m]]');
  assert.deepEqual(t.size, [20000, 20000, 20000]);
  assert.deepEqual(t.capacityAt, [10000, 2000, 0]);
  assert.equal(p.parseParams('<Service Modules.S1(Green),Servcice Modules.S2(Blue)>').spaceList[1].detail, 'Blue');
});

test('a node list keeps its directions, however they are written', () => {
  const n = p.parseParams('{<01(C19),<02(C13),>Power in(C20)}<A,B>');
  assert.equal(n.nodes, '<01(C19),<02(C13),>Power in(C20)');
  assert.equal(n.spaces, 'A,B');
  assert.equal(p.parseParams('{>SFP 01{01,02},>SFP 02{01,02}}').nodes, '>SFP 01{01,02},>SFP 02{01,02}');
});
