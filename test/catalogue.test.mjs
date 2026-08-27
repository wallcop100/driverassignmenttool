// Matching real ElementTypeName values. Every name below is live data from the
// current commit of a lighting branch — including the typos, because those are
// what the matcher exists to survive.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PARTS, matchPart, matchParts, reachableW } from '../src/catalogue.js';

// name -> expected part (null = correctly not in the catalogue), rows in live data
const LIVE = [
  ['EldoLED - SoloDrive 360/A', 'EldoLED SoloDrive 360/A', 163],
  ['EldoLED - DualDrive 560/A', 'EldoLED DualDrive 560/A', 64],
  ['EldoLED LINEARDrive 200D-D2Z2C & Meanwell HLG18524', 'EldoLED LinearDrive 200D-D2Z2C', 27],
  ['EldoLED - SoloDrive 240/A', 'EldoLED SoloDrive 240/A', 24],
  ['EldoLED - DualDrive 562/A', 'EldoLED DualDrive 562/A', 24],
  ['Meanwell - HLG-185-48', null, 22],                       // 48V variant, no spec page
  ['EldoLED LinDrive 200D & Meanwell HLG-185-24', 'Meanwell HLG-185-24', 21], // 200D alone is ambiguous
  ['Eldoled SLO360/A', 'EldoLED SoloDrive 360/A', 20],
  ['EldoLED - LINDrive 220D & Meanwel HLG-185-24', 'EldoLED LinearDrive 220D', 19],
  ['PowerLED - PCV24101', null, 19],                          // 24101 is not 24100
  ['EldoLED SoloDrive 360/A', 'EldoLED SoloDrive 360/A', 17],
  ['PowerLED PCV24100', 'PowerLED PCV24100', 13],
  ['Meanwell - HLG-185-24 & EldoLED - LinDrive LIN200D-D2Z2C', 'EldoLED LinearDrive 200D-D2Z2C', 12],
  ['PowerLED - PCC35012', 'PowerLED PCC35012', 11],
  ['Cisco CVR-QSFP-SFP10G=', null, 10],                       // not a driver at all
  ['EldoLED SOLODrive 360/A at 300mA', 'EldoLED SoloDrive 360/A', 9],
  ['eldoLED LINEARdrive 220D & Meanwell HLG18524', 'EldoLED LinearDrive 220D', 8],
  ['EldoLED 200D-D2Z2C2  & Meanwell HLG18524', 'EldoLED LinearDrive 200D-D2Z2C', 8],
  ['EldoLED - SoloDrive 560/A', 'EldoLED SoloDrive 560/A', 7],
  ['EldoLED - DL0560S3 - 500mA', 'EldoLED DualDrive 560/A', 7],
  ['Meanwell - HLG18524', 'Meanwell HLG-185-24', 7],
  ['EldoLED - SoloDrive  360/A', 'EldoLED SoloDrive 360/A', 7],     // double space
  ['EldoLED - SOLODrive 360/A, set to 500mA', 'EldoLED SoloDrive 360/A', 7],
  ['EldoLED - SLO560S3 - 260mA', 'EldoLED SoloDrive 560/A', 6],
  ['EldoLED EcoDrive 367/A', null, 6],              // a different part — no spec page for it
  ['EldoLED - EcoDrive 240/A', 'EldoLED EcoDrive 240/A', 1],
  ['Eldoled DUALdrive 20MA-E2Z0C', 'EldoLED DualDrive 20MA-E2Z0C', 6],
  ['EldoLED LinearDrive 220D', 'EldoLED LinearDrive 220D', 6],
  ['EldoLED - Solo 240/A', 'EldoLED SoloDrive 240/A', 5],
  ['EldoLED - SL0240A3 - 260mA', 'EldoLED SoloDrive 240/A', 4],     // zero for O
  ['EldoLED - PowderDrive 106S1', 'EldoLED PowerDrive 106/S', 3],   // typo
  ['EldoLED LINEARdrive 220/D & HLG-185H-24A', 'EldoLED LinearDrive 220D', 4],
  ['EldoLED - DualDrive560/A', 'EldoLED DualDrive 560/A', 3],       // no space
  ['Provisional driver for F102', null, 4],
  ['Constant Current Driver Provision for Remote DALI Feed', null, 4],
  ['ILOC XRC16-0350P-UNV-I', null, 4],                              // no spec page
  ['Meanwell - APV-35-24', null, 4],
  ['EldoLED - LinearDrive 220D, Meanwell - HLG-185-24', 'EldoLED LinearDrive 220D', 9],
  ['Phos - INF105006D', 'Phos INF105006D', 2],
];

test('every part has a pattern and a wattage', () => {
  assert.equal(PARTS.length, 34);
  for (const p of PARTS) {
    assert.ok(p.re instanceof RegExp, p.name);
    assert.ok(p.maxPowerW > 0, p.name);
    assert.ok(p.powerType === 'CC' || p.powerType === 'CV', p.name);
    if (p.powerType === 'CC') assert.ok(p.maxA >= p.minA, p.name);
  }
});

test('matches live ElementTypeName values, typos and all', () => {
  const misses = [];
  for (const [name, expected] of LIVE) {
    const got = matchPart(name)?.name ?? null;
    if (got !== expected) misses.push(`${name}\n    expected ${expected}, got ${got}`);
  }
  assert.deepEqual(misses, [], `\n  ${misses.join('\n  ')}`);
});

test('a name carrying both a driver and its supply returns the driver first', () => {
  const both = matchParts('EldoLED - LinDrive 220D & Meanwell - HLG-185-24');
  assert.deepEqual(both.map((p) => p.name), ['EldoLED LinearDrive 220D', 'Meanwell HLG-185-24']);
});

test('reachable wattage: PSU cap for CV, current x fV x outputs for CC', () => {
  const lin = PARTS.find((p) => p.name === 'EldoLED LinearDrive 220D');
  assert.equal(reachableW(lin), 185);                       // 200W part, 185W PSU

  const dual = PARTS.find((p) => p.name === 'EldoLED DualDrive 560/A');
  assert.equal(reachableW(dual, 0.3), 33);                  // 0.3A x 55fV x 2 outputs
  assert.equal(reachableW(dual, 1.4), 50);                  // never above the rating

  const solo = PARTS.find((p) => p.name === 'EldoLED SoloDrive 360/A');
  assert.equal(reachableW(solo, 0.26), 14.3);               // the 50W in the data is impossible
  assert.equal(reachableW(solo), null);                     // no current, nothing to derive
});
