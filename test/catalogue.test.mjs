// Matching real ElementTypeName values. Every name below is live data from the
// current commit of a lighting branch — including the typos, because those are
// what the matcher exists to survive.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PARTS, matchPart, matchParts, reachableW, resolveSpec } from '../src/catalogue.js';
import { nextTypeRef } from '../src/engine.js';

// name -> expected part (null = correctly not in the catalogue), rows in live data
const LIVE = [
  ['EldoLED - SoloDrive 360/A', 'EldoLED SoloDrive 360/A', 163],
  ['EldoLED - DualDrive 560/A', 'EldoLED DualDrive 560/A', 64],
  ['EldoLED LINEARDrive 200D-D2Z2C & Meanwell HLG18524', 'EldoLED LinearDrive 200D-D2Z2C', 27],
  ['EldoLED - SoloDrive 240/A', 'EldoLED SoloDrive 240/A', 24],
  ['EldoLED - DualDrive 562/A', 'EldoLED DualDrive 562/A', 24],
  ['Meanwell - HLG-185-48', 'Meanwell HLG-185-48', 22],       // derived from the part number
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
  assert.equal(reachableW(resolveSpec('LinDrive 220D & Meanwell HLG-185-24')), 185);
  assert.equal(reachableW(PARTS.find((p) => p.name === 'EldoLED LinearDrive 220D')), null); // no PSU named

  const dual = PARTS.find((p) => p.name === 'EldoLED DualDrive 560/A');
  assert.equal(reachableW(dual, 0.3), 33);                  // 0.3A x 55fV x 2 outputs
  assert.equal(reachableW(dual, 1.4), 50);                  // never above the rating

  const solo = PARTS.find((p) => p.name === 'EldoLED SoloDrive 360/A');
  assert.equal(reachableW(solo, 0.26), 14.3);               // the 50W in the data is impossible
  assert.equal(reachableW(solo), null);                     // no current, nothing to derive
});

// ---- PSU + driver pairs, which is how CV is normally specified ----
test('a DC/DC driver takes its rail and its cap from the supply', () => {
  const on185 = resolveSpec('EldoLED - LINDrive 220D & Meanwel HLG-185-24');
  assert.equal(on185.maxPowerW, 185);        // 200W driver, 185W supply
  assert.equal(on185.outputV, 24);
  assert.equal(on185.outputs, 2);
  assert.equal(on185.addresses, 2);

  // the SAME driver on a 12V supply is a different specification entirely
  const on12 = resolveSpec('EldoLED LinDrive 220D & Meanwell HLG-80-12');
  assert.equal(on12.maxPowerW, 80);
  assert.equal(on12.outputV, 12);

  // and an oversized supply doesn't lift the driver above its own rating
  const big = resolveSpec('EldoLED - LinearDrive 220D (x2), Meanwell - HLG-320-24');
  assert.equal(big.maxPowerW, 200);

  // a per-output current cap only becomes watts once the rail is known
  const l720 = resolveSpec('EldoLED LinearDrive 720/D & Meanwell HLG60024');
  assert.equal(l720.maxPowerW, 600);
  assert.equal(l720.nodeMaxLoadW, 144);      // 6A x 24V
  assert.equal(resolveSpec('EldoLED LinDrive 720D & Meanwell HLG-150-12').nodeMaxLoadW, 72);
});

test('Meanwell supplies are read from the part number when there is no page', () => {
  // HLG-{watts}-{volts}, which every supply with a spec page follows
  const s = resolveSpec('Meanwell - HLG-185-48');
  assert.equal(s.maxPowerW, 185);
  assert.equal(s.outputV, 48);
  assert.ok(s.derived);
  assert.equal(resolveSpec('Meanwell - HLG60024').maxPowerW, 600);
  assert.equal(resolveSpec('EldoLED LINEARdrive 220/D & HLG-120H-12A').outputV, 12);
  // a part that IS in the catalogue is not re-derived
  assert.ok(!resolveSpec('Meanwell - HLG-185-24').derived);
});

test('a CV pair gets the ref its rail implies', () => {
  const spec = resolveSpec('EldoLED - LinearDrive 220D, Meanwell - HLG-185-24');
  assert.equal(
    nextTypeRef([], { powerType: 'CV', outputVoltageV: spec.outputV, addresses: spec.addresses }),
    'ET-CVR-D-24-2CH-01',   // the ref this pairing actually has in live data
  );
});
