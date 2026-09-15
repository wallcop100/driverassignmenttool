// Node and slot recipes, the two halves of what a container declares. Both tools
// read them; DJ 101676 documents the three traps and they are all covered here.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseNodeList, parseSlotList, slotKey, sameSlot } from '../../src/core/nodes.js';

test('a node recipe gives names a link end can be written against', () => {
  // a driver's outputs
  assert.deepEqual(parseNodeList('{<OP.1,<OP.2}').map((n) => n.name), ['OP.1', 'OP.2']);
  // a panel module's terminals, with a detail on one
  const t = parseNodeList('{<A(DL1),>NET}');
  assert.deepEqual(t.map((n) => n.name), ['A', 'NET']);
  assert.equal(t[0].detail, 'DL1', 'the detail is kept, off the name');
  assert.equal(t[0].dir, '<');
  assert.equal(parseNodeList('{<>Passthrough}')[0].dir, '<>', 'a through node');
  assert.deepEqual(parseNodeList(''), []);
  assert.deepEqual(parseNodeList('{}'), []);
});

test('a blank slot in the recipe is a real spare way, not a gap to skip', () => {
  // ET-LCP-PD7, live: <1,2,3,,4,5,6,7,P1,LB1>
  const slots = parseSlotList('<1,2,3,,4,5,6,7,P1,LB1>');
  assert.equal(slots.length, 10);
  assert.equal(slots[3].blank, true);
  assert.equal(slots[3].name, '');
  assert.deepEqual(slots.filter((s) => !s.blank).map((s) => s.name).slice(-2), ['P1', 'LB1']);
});

test('<1> and <01> are the same slot, and <1.1> folds onto slot 1', () => {
  assert.ok(sameSlot('1', '01'));
  assert.ok(sameSlot('08', '8'));
  assert.ok(sameSlot('1.1', '1'), 'dot syntax groups');
  assert.ok(sameSlot('P.1', 'P1'), 'and a dotted power way is the same power way');
  // sub-ways GROUP onto their way - 08a and 08b are both in way 08, which is
  // 101676's "several modules in one position, laid side by side"
  assert.ok(sameSlot('08a', '08'));
  assert.ok(sameSlot('08a', '08b'), 'both belong to way 08');
  assert.ok(sameSlot('1.1', '1.2'), 'and dot syntax groups the same way');
  assert.equal(slotKey('LB1'), 'LB1');
  assert.ok(!sameSlot('LB1', 'LB2'));
});

test('a live panel recipe reads as its slots', () => {
  // ET-LCP5-Panel on set 109311
  const slots = parseSlotList('<01,02,03,04,05,06,07,08,08a,08b,LB1,LB2,P1,P2,P3>');
  assert.equal(slots.length, 15);
  assert.equal(slots.filter((s) => s.blank).length, 0);
  assert.deepEqual(slots.slice(-3).map((s) => s.name), ['P1', 'P2', 'P3']);
});

test('every terminal recipe live on branch 10328 parses to usable names', () => {
  // Real Parameters off set 108962. If a name comes back wrong, no link end can
  // ever match it and the terminal silently cannot be assigned to.
  const cases = [
    ['{<A(DA1),<B(DA2),>LINK}', ['A', 'B', 'LINK']],            // ET-MOD-DALI-LUTRON
    ['{<L1,<L2,>ETH}', ['L1', 'L2', 'ETH']],                     // ET-MOD-QSX-PROC-2
    ['{<NET,<24(24/G Only)}', ['NET', '24']],                    // ET-MOD-PSU
    ['{BUS.1,BUS.2,BUS.3,BUS.4,BUS.5}', ['BUS.1', 'BUS.2', 'BUS.3', 'BUS.4', 'BUS.5']], // ET-KPL
    ['{>LAN,NET<>,<24(24V Input)}', ['LAN', 'NET', '24']],        // ET-MOD-AP4
    ['{>NET.MASTER,<NET.A,<NET.B,<NET.C}', ['NET.MASTER', 'NET.A', 'NET.B', 'NET.C']], // ET-MOD-HUB
    ['{>LAN,<NET.1,<NET.2}', ['LAN', 'NET.1', 'NET.2']],          // ET-MOD-CENCN2
  ];
  for (const [params, names] of cases) {
    assert.deepEqual(parseNodeList(params).map((n) => n.name), names, params);
  }
});

test('direction is read whichever side of the name it is written', () => {
  // ET-MOD-AP4 writes both in one recipe
  const ap4 = parseNodeList('{>LAN,NET<>,<24(24V Input)}');
  assert.equal(ap4[0].dir, '>', 'prefixed');
  assert.equal(ap4[1].dir, '<>', 'suffixed - a through node');
  assert.equal(ap4[1].name, 'NET', 'and the name is not "NET<>"');
  assert.equal(ap4[2].detail, '24V Input');
  // a detail may carry punctuation and spaces
  assert.equal(parseNodeList('{<24(24/G Only)}')[0].detail, '24/G Only');
});
