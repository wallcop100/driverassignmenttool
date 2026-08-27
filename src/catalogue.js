// Driver datasheet catalogue — static knowledge, transcribed from the Driver
// Specs page group (59 pages across 5 projects; project 123 "Lighting and
// Shading Technology" is the master and its copies are the ones used here).
//
// Why static: this app is a sandboxed iframe on GitHub Pages and cannot reach
// Kaizen. The specs change about as often as the hardware does, so a checked-in
// copy refreshed by hand beats a lookup that can't happen. REFRESH.md next to
// this file says how to regenerate it.
//
// What it is FOR: the ElementTypes library states ratings for ~4% of driver
// types, so most of the time the tool is asked to size a driver whose
// electrical properties nobody wrote down. The type's Name almost always says
// which part it is — "EldoLED SOLODrive 360/A at 300mA", "SLO560S3" — so the
// datasheet can be recovered from the name and offered to the user.
//
// Fields, in DesignDB terms:
//   maxPowerW   MaxPower(W)                 the part's headline rating
//   minA/maxA   the CC current RANGE        CurrentRange picks one value in it
//   outputV     OutputVoltage(V)            CV only
//   maxFvV      NodeMaxForwardVoltage(fV)   top of the datasheet voltage range
//   outputs     Parameters {<OP.1,...}      LED outputs
//   addresses   BallastCountPerUoM          DALI addresses — the nCH in a ref
//
// outputs and addresses are NOT the same number: a SoloDrive 560/A is two
// outputs on one address, which is exactly what separates it from a DualDrive
// 560/A (two outputs, two addresses). A ref's "1CH" counts addresses.

export const PARTS = [
  // ---- EldoLED constant current ----
  { name: 'EldoLED SoloDrive 240/A', re: /(?:solo|slo|sl0)[a-z]*240/, powerType: 'CC',
    maxPowerW: 20, minA: 0.15, maxA: 1.05, maxFvV: 40, outputs: 1, addresses: 1,
    controlType: 'DALI', page: 105740 },
  { name: 'EldoLED SoloDrive 360/A', re: /(?:solo|slo|sl0)[a-z]*360/, powerType: 'CC',
    maxPowerW: 30, minA: 0.15, maxA: 1.4, maxFvV: 55, outputs: 1, addresses: 1,
    controlType: 'DALI', page: 105744 },
  { name: 'EldoLED SoloDrive 560/A', re: /(?:solo|slo|sl0)[a-z]*560/, powerType: 'CC',
    maxPowerW: 50, minA: 0.15, maxA: 1.4, maxFvV: 55, outputs: 2, addresses: 1,
    controlType: 'DALI', page: 128706 },
  { name: 'EldoLED SoloDrive 20CA-E1Z0D', re: /(?:solo|slo)[a-z]*20ca/, powerType: 'CC',
    maxPowerW: 20, minA: 0.15, maxA: 1.05, maxFvV: 40, outputs: 1, addresses: 1,
    controlType: 'DALI', page: 105741 },
  { name: 'EldoLED DualDrive 560/A', re: /(?:dual|dl0|dlo)[a-z]*560/, powerType: 'CC',
    maxPowerW: 50, minA: 0.15, maxA: 1.4, maxFvV: 55, outputs: 2, addresses: 2,
    controlType: 'DALI', page: 105742 },
  { name: 'EldoLED DualDrive 562/A', re: /(?:dual|dl0|dlo)[a-z]*562/, powerType: 'CC',
    maxPowerW: 50, minA: 0.15, maxA: 1.4, maxFvV: 55, outputs: 2, addresses: 1,
    controlType: 'DALI', page: 124310 },
  { name: 'EldoLED DualDrive 20CA-E2Z0C', re: /(?:dual|dl0|dlo)[a-z]*20ca/, powerType: 'CC',
    maxPowerW: 20, minA: 0.15, maxA: 1.05, maxFvV: 40, outputs: 2, addresses: 1,
    controlType: 'DALI', page: 124431 },
  { name: 'EldoLED DualDrive 20MA-E2Z0C', re: /(?:dual|dl0|dlo)[a-z]*20ma/, powerType: 'CC',
    maxPowerW: 20, minA: 0.15, maxA: 1.05, maxFvV: 40, outputs: 2, addresses: 1,
    controlType: 'DALI', page: 105743 },
  { name: 'EldoLED EcoDrive 240/A', re: /eco[a-z]*240/, powerType: 'CC',
    maxPowerW: 20, minA: 0.15, maxA: 1.05, maxFvV: 40, outputs: 1, addresses: 1,
    controlType: 'DALI', page: 131065 },
  { name: 'EldoLED PowerDrive 106/S', re: /pow[a-z]*106/, powerType: 'CC',
    maxPowerW: 100, minA: 0.2, maxA: 1.05, maxFvV: 57, outputs: 4, addresses: 4,
    controlType: 'DALI', page: 128633 },

  // ---- EldoLED constant voltage (LinearDrive) ----
  // These are DC/DC: the wattage is the driver's own, and the PSU it is paired
  // with can cap it lower. Where the datasheet says so, psuLimitW carries the cap.
  { name: 'EldoLED LinearDrive 100/A', re: /lin[a-z]*100/, powerType: 'CV',
    maxPowerW: 100, outputs: 4, addresses: 4, controlType: 'DALI', page: 105850 },
  { name: 'EldoLED LinearDrive 220D', re: /lin[a-z]*220/, powerType: 'CV',
    maxPowerW: 200, psuLimitW: 185, outputV: 24, outputs: 2, addresses: 2,
    controlType: 'DALI', page: 137217 },
  { name: 'EldoLED LinearDrive 222D', re: /lin[a-z]*222/, powerType: 'CV',
    maxPowerW: 192, psuLimitW: 185, outputV: 24, outputs: 2, addresses: 2,
    controlType: 'DMX', page: 105847,
    note: 'Spec page says "Outputs: 4" while its description says 2-channel — outputs unconfirmed' },
  { name: 'EldoLED LinearDrive 200D-D2Z2D', re: /200d?d2z2d/, powerType: 'CV',
    maxPowerW: 200, psuLimitW: 185, outputV: 24, outputs: 2, addresses: 2,
    controlType: 'DALI', page: 105745 },
  { name: 'EldoLED LinearDrive 200D-D2Z2C', re: /200d?d2z2c/, powerType: 'CV',
    maxPowerW: 192, psuLimitW: 185, outputV: 24, outputs: 2, addresses: 2,
    controlType: 'DALI', page: 106074 },
  { name: 'EldoLED LinearDrive 720D', re: /lin[a-z]*720/, powerType: 'CV',
    maxPowerW: 720, outputV: 24, nodeMaxLoadW: 144, nodeCurrentA: 6,
    outputs: 4, addresses: 4, controlType: 'DALI', page: 105811 },

  // ---- constant voltage supplies ----
  // No LED outputs of their own: they feed a DC/DC driver. Given an outputs
  // count of 1 so a preset built from one is well formed, but they are not
  // normally what a cable is assigned to.
  { name: 'Meanwell HLG-185-24', re: /hlg185h?24/, powerType: 'CV',
    maxPowerW: 185, outputV: 24, outputs: 1, controlType: 'Local', page: 106079 },
  { name: 'Meanwell HLG-150-24', re: /hlg150h?24/, powerType: 'CV',
    maxPowerW: 150, outputV: 24, outputs: 1, controlType: 'Local', page: 140230 },
  { name: 'Meanwell HLG-150-48', re: /hlg150h?48/, powerType: 'CV',
    maxPowerW: 150, outputV: 48, outputs: 1, controlType: 'Local', page: 140232 },
  { name: 'Meanwell HLG-100-24', re: /hlg100h?24/, powerType: 'CV',
    maxPowerW: 100, outputV: 24, outputs: 1, controlType: 'Local', page: 140228 },
  { name: 'Meanwell HLG-100H-54', re: /hlg100h?54/, powerType: 'CV',
    maxPowerW: 100, outputV: 54, outputs: 1, controlType: 'Local', page: 128658 },
  { name: 'Meanwell HLG-80H-24', re: /hlg80h?24/, powerType: 'CV',
    maxPowerW: 80, outputV: 24, outputs: 1, controlType: 'Local', page: 128641 },
  { name: 'PowerLED PCV24100', re: /pcv24100/, powerType: 'CV',
    maxPowerW: 100, outputV: 24, outputs: 1, controlType: 'Local', page: 106081 },
  { name: 'PowerLED PCV24150', re: /pcv24150/, powerType: 'CV',
    maxPowerW: 150, outputV: 24, outputs: 1, controlType: 'Local', page: 131064 },
  { name: 'PowerLED PCV2460', re: /pcv2460/, powerType: 'CV',
    maxPowerW: 60, outputV: 24, outputs: 1, controlType: 'Local', page: 106080 },
  { name: 'PowerLED PCV1212', re: /pcv1212/, powerType: 'CV',
    maxPowerW: 12, outputV: 12, outputs: 1, controlType: 'Local', page: 140234 },
  { name: 'EcoPac ELED-30P-T', re: /eled30pt/, powerType: 'CV',
    maxPowerW: 30, outputV: 12, outputs: 1, controlType: 'PHASE', page: 131145 },

  // ---- fixed-current drivers (no range: one current, as built) ----
  { name: 'PowerLED PCC50020', re: /pcc50020/, powerType: 'CC',
    maxPowerW: 20, minA: 0.5, maxA: 0.5, maxFvV: 40, outputs: 1, controlType: 'Local', page: 131143 },
  { name: 'PowerLED PCC35012', re: /pcc35012/, powerType: 'CC',
    maxPowerW: 12, minA: 0.35, maxA: 0.35, maxFvV: 34, outputs: 1, controlType: 'Local', page: 124502 },
  { name: 'Orluna DRIVER-N-300', re: /drivern300/, powerType: 'CC',
    maxPowerW: 12, minA: 0.3, maxA: 0.3, maxFvV: 40, outputs: 1, controlType: 'Local', page: 124432 },
  { name: 'TCI Mini Jolly MD 20', re: /minijollymd20/, powerType: 'CC',
    maxPowerW: 14, minA: 0.3, maxA: 0.3, maxFvV: 48, outputs: 1, controlType: 'PHASE', page: 124514 },
  { name: 'EcoPac ELED-10P-C100-450T', re: /eled10pc100450t/, powerType: 'CC',
    maxPowerW: 6.3, minA: 0.18, maxA: 0.18, maxFvV: 42, outputs: 1, controlType: 'PHASE', page: 131153 },
  { name: 'Phos INF105006D', re: /inf105006d/, powerType: 'CC',
    maxPowerW: 6, minA: 1.05, maxA: 1.05, maxFvV: 6, outputs: 1, controlType: 'Local', page: 140237 },
  { name: 'LitePlan NLP/1/TP40/R', re: /nlp1tp40r/, powerType: 'CC',
    maxPowerW: 2.2, minA: 0.9, maxA: 0.9, maxFvV: 55, outputs: 1, addresses: 1,
    controlType: 'Local', page: 124308, note: 'Emergency, 3 hour discharge' },
];

// ElementTypeName is free text — "EldoLED SOLODrive 360/A at 300mA",
// "EldoLED - SLO560S3 - 260mA", "EldoLED - LinearDrive 220D, Meanwell - HLG-185-24".
// So: strip everything that isn't a letter or digit, lowercase, and look for a
// part's key as a substring. Nothing here is anchored or exact.
const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Every part whose pattern appears in the text. A type naming both a driver and
// its supply ("LinDrive 220D & Meanwell HLG-185-24") matches both; drivers are
// returned first, because the driver is the part being specified and the supply
// is the cap on it.
const isSupply = (p) => p.controlType === 'Local' && p.outputs === 1 && p.psuLimitW == null
  && /^(Meanwell|PowerLED PCV|EcoPac ELED-30)/.test(p.name);

export function matchParts(elementTypeName) {
  const hay = norm(elementTypeName);
  if (!hay) return [];
  const hits = PARTS.filter((p) => p.re.test(hay));
  return hits.sort((a, b) => (isSupply(a) ? 1 : 0) - (isSupply(b) ? 1 : 0));
}

export const matchPart = (elementTypeName) => matchParts(elementTypeName)[0] ?? null;

// The wattage a part can actually deliver, which is not always its headline
// rating: a DC/DC driver on a smaller PSU is capped by the PSU, and a CC driver
// set to one current can only reach current x forward voltage x outputs.
// Returns null when the part doesn't constrain it.
export function reachableW(part, currentA) {
  if (!part) return null;
  const caps = [];
  if (part.psuLimitW != null) caps.push(part.psuLimitW);
  if (part.powerType === 'CC' && currentA != null && part.maxFvV != null) {
    caps.push(currentA * part.maxFvV * (part.outputs ?? 1));
  }
  if (!caps.length) return null;
  return Math.min(part.maxPowerW ?? Infinity, ...caps);
}
