// A driver type's notes naming the fittings it is for ("For A2, A6 type's") reserve it for them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../src/engine.js';
import { typesCsvFromSheets, positionLabels } from '../src/designdb.js';

test('noteTargets reads the fittings a note names, from the ElementTypes wording in use', () => {
  const t = engine.noteTargets;
  assert.deepEqual(t("For A2, A6 type's").forPts, ['a2', 'a6']);
  assert.deepEqual(t("For A7, A7a type's").forPts, ['a7', 'a7a']);
  assert.deepEqual(t('For K1 track').forPts, ['k1']);
  assert.deepEqual(t('For D17 fittings').forPts, ['d17']);
  assert.deepEqual(t('Used with B2 & B3').forPts, ['b2', 'b3']);
  assert.deepEqual(t('Used for M2 and M4').forPts, ['m2', 'm4']);
  assert.deepEqual(t('Final mA requirements & LightShape Profile TBC | For A1b type\'s').forPts, ['a1b']);
  // nothing ref-shaped: no reservation
  assert.deepEqual(t('Space provisions for potential remote drivers').forPts, []);
  assert.deepEqual(t('30W, set to 180mA, 55V, 1 channel').forPts, []);
  assert.equal(t('').forNote, null);
  assert.equal(t("For A3 type's").forNote, "For A3 type's");
});

const head = '"Link_SecondaryPowerRef","ControlTypeRef","PositionTypeRef","PositionTypeBestRef","SumQuantity","SecondaryPowerType","PositionVoltage","PositionCurrent","SumVf","SumPower"';
const cc = (typeRef, forText = '', maxPowerW = 50) => ({
  typeRef, powerType: 'CC', currentA: 0.25, maxPowerW, controlType: 'DALI',
  ...engine.noteTargets(forText), nodes: [{ name: 'OP.1', maxLoadW: maxPowerW }],
});

test('estimate: a noted type is picked for its fittings and never for others; noted fittings get their own line', () => {
  const requirements = engine.parseAssessment(`${head}
"H1","DALI","PT-12","A2","2","CC","0","0.25","0","10"
"H1","DALI","PT-13","A3","2","CC","0","0.25","0","10"
`);
  assert.equal(requirements[0].ptLabel, 'A2');
  const inventory = [cc('PLAIN'), cc('FOR-A2', "For A2, A6 type's")];
  // kept together by type off, but A2 has a noted type so it is split out
  const p = engine.planFromRequirements({ requirements, inventory }, 'H1', { splitByType: false });
  const a2 = p.lines.find((l) => l.positionTypes.includes('PT-12'));
  const a3 = p.lines.find((l) => l.positionTypes.includes('PT-13'));
  assert.notEqual(a2, a3);
  assert.equal(a2.typeRef, 'FOR-A2');
  assert.equal(a2.noted, "For A2, A6 type's");
  assert.equal(a3.typeRef, 'PLAIN');
  assert.ok(!a3.fitTypes.includes('FOR-A2'));
});

test('estimate: a noted type that cannot take its fittings is flagged and the pick falls back', () => {
  const requirements = engine.parseAssessment(`${head}\n"H1","DALI","PT-12","A2","1","CC","0","0.25","0","80"\n`);
  const p = engine.planFromRequirements({ requirements, inventory: [cc('PLAIN', '', 100), cc('FOR-A2', 'For A2', 50)] }, 'H1');
  assert.equal(p.lines[0].typeRef, 'PLAIN');
  assert.match(p.lines[0].noteIssue, /FOR-A2 is noted for A2 but can't take them: too small/);
});

test('estimate: a note naming nothing in the job reserves nothing', () => {
  const requirements = engine.parseAssessment(`${head}\n"H1","DALI","PT-13","A3","1","CC","0","0.25","0","10"\n`);
  const p = engine.planFromRequirements({ requirements, inventory: [cc('USED-WITH', 'Used with LIN200D')] }, 'H1');
  assert.equal(p.lines[0].typeRef, 'USED-WITH');
});

test('estimate: matches the PositionType Ref too, when no label is known', () => {
  const requirements = engine.parseAssessment(`${head}\n"H1","DALI","A2","","1","CC","0","0.25","0","10"\n`);
  const p = engine.planFromRequirements({ requirements, inventory: [cc('PLAIN'), cc('FOR-A2', 'For A2')] }, 'H1');
  assert.equal(p.lines[0].typeRef, 'FOR-A2');
});

test('DesignDB: notes reach the type CSV, and PositionType labels come from ExtRef', () => {
  const csv = typesCsvFromSheets({ ElementTypes: [
    { Ref: 'ET-1', Name: 'x', Parameters: '{OP.01<}', Description: '50W', Details: "For A3 type's", InternalNotesText: 'Final TBC' },
  ] });
  const types = engine.parseTypes(csv);
  assert.deepEqual(types[0].forPts, ['a3']);
  assert.deepEqual(positionLabels([{ Ref: 'PT-1', ExtRef: 'A3' }, { Ref: 'PT-2', ExtRef: '' }, { Ref: 'PT-3', ExtRef: 'X', IsDeleted: 'Y' }]),
    { 'PT-1': 'A3' });
});
