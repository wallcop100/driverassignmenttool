// Moving modules between a panel's ways, and the patch that records it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSlotList } from '../../src/core/nodes.js';
import { rowFor, panelPatch, WAY_TS } from '../../src/lcp/panelPatch.js';

const setWay = new Function(`${WAY_TS.replace(/: string/g, '')}; return setWay;`)();
// ET-LCP5-Panel as project 5294 declares it
const LCP5 = parseSlotList('<01,02,03,04,05,06,07,08,08a,08b,LB1,LB2,P1,P2,P3>');

test('a written way finds its row however the estate spelled it', () => {
  assert.equal(rowFor('01.a', LCP5), '01', 'dot groups: two modules sharing way 01');
  assert.equal(rowFor('01.b', LCP5), '01');
  assert.equal(rowFor('08a', LCP5), '08a', 'declared, so its own row');
  assert.equal(rowFor('8', LCP5), '08', '<8> is <08>');
  assert.equal(rowFor('P.1', LCP5), 'P1', '<P.1> is <P1>');
  assert.equal(rowFor('LB2', LCP5), 'LB2');
  assert.equal(rowFor('3.1', parseSlotList('<1,2,3,4,5>')), '3');
  assert.equal(rowFor('', LCP5), null);
  assert.equal(rowFor('ZZ9', LCP5), null, 'a way the panel does not declare');
});

test('the way is merged into ContextParameters, leaving anything else there', () => {
  assert.equal(setWay('[15mm,,]<03>', '01'), '<01>[15mm,,]');
  assert.equal(setWay('', '01'), '<01>');
  assert.equal(setWay('<03>', ''), '', 'out of every way');
});

test('the patch writes only what moved, on Elements, signed by the LCP tool', () => {
  const s = panelPatch([{ ref: 'E08004', to: '02' }, { ref: 'E08013', to: '' }]);
  assert.match(s, /^\/\/ Lighting DesignDB patch - LCP Assignment Tool/);
  assert.match(s, /columnIndex\(WS_E, "ContextParameters", true\)/);
  assert.match(s, /"ref":"E08004","to":"02"/);
  assert.match(s, /"ref":"E08013","to":""/);
  assert.doesNotMatch(s, /setValue\(""\)/, 'an emptied way is cleared, never set blank');
  assert.equal(s.split('function main(').length - 1, 1);
  assert.match(panelPatch([]), /Nothing to move/);
});
