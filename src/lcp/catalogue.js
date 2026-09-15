// What a Lutron DIN module can actually carry.
//
// Straight off the Lutron specification submittals. Two things matter and the
// driver tool already has the shape for both: a PER-OUTPUT limit and a TOTAL
// module limit that the outputs share. A phase module can be within every one of
// its four zone limits and still be over its 10 A module total.
//
// The per-zone figures are NOT uniform. On the LQSE-4A5-230-D, zone 1 takes
// nearly twice what zones 2-4 take - so a limit is per zone INDEX, not per
// module. Getting that wrong passes an overload on zone 2.
//
// Load type matters too: the same zone is 250 W of LED or 800 W of
// incandescent. `maxW` is the LED figure, because that is what these panels
// are dimming; `maxWResistive` is kept for the rare tungsten circuit.
//
// MATCHING IS MANUFACTURER-FIRST, and that is not fussiness. project 5294
// (project 5294) writes `ET-MOD-PHASE` for a **Crestron DIN-1DIMU4**; matching
// on the ref alone claimed Lutron's 400W/250W zone limits for a Crestron module
// rated 5A a channel. The ref says what a module DOES; only the Name says who
// made it. So a limit is claimed only when the manufacturer is evident, and a
// module whose maker cannot be told is given no limit at all.
export const MODULES = [
  // ---- Lutron (HomeWorks QS / QSX) -----------------------------------------
  {
    make: 'Lutron', model: 'LQSE-4A5-230-D',
    name: 'PRO LED+ phase adaptive, 4 zone',
    re: /4a5|lqse-4a/i, kind: 'phase', outputs: 4,
    // zone 1 first, then 2-4 - the per-zone figures are NOT uniform
    perOutputA: [1.7, 1.0, 1.0, 1.0],
    perOutputW: [400, 250, 250, 250],
    perOutputWResistive: [1200, 800, 800, 800],
    totalA: 10,
    source: 'Lutron 3691155',
  },
  {
    make: 'Lutron', model: 'LQSE-4S10-D', name: 'switching module, 4 zone',
    re: /4s10|lqse-4s/i, kind: 'switch', outputs: 4,
    perOutputA: [10, 10, 10, 10], perOutputW: null,
    totalA: null,                 // the outputs are independent, not shared
    source: 'Lutron 369610a',
  },
  {
    make: 'Lutron', model: 'LQSE-4M-D', name: 'motor module, 4 zone',
    re: /4m-d|lqse-4m/i, kind: 'motor', outputs: 4,
    perOutputA: null, perOutputW: null, totalA: null,
    source: null,                 // Lutron do not publish a per-zone figure
  },
  {
    make: 'Lutron', model: 'LQSE-2DAL-D', name: 'DALI module, 2 loop',
    re: /2dal|dali/i, kind: 'dali', outputs: 2,
    // a DALI loop is a signal bus, not a dimmed output: its limit is devices and
    // control groups, which the control-intent rules cover
    perOutputA: null, perOutputW: null, totalA: null, source: null,
  },

  // ---- Crestron (DIN rail) --------------------------------------------------
  {
    make: 'Crestron', model: 'DIN-1DIMU4', name: 'DIN rail universal dimmer, 4 channel',
    re: /1dimu4|dimu/i, kind: 'phase', outputs: 4,
    perOutputA: [5, 5, 5, 5], perOutputW: null,
    totalA: 10,                   // 5 A a channel, 10 A across the module
    source: 'Crestron DIN-1DIMU4 spec sheet',
  },
  {
    make: 'Crestron', model: 'DIN-8SW8-I', name: 'DIN rail high-voltage switch, 8 channel',
    re: /8sw8/i, kind: 'switch', outputs: 8,
    perOutputA: [10, 10, 10, 10, 10, 10, 10, 10],
    perOutputAFluorescent: 5,     // 10 A incandescent, 5 A fluorescent
    perOutputW: null, totalA: null,
    source: 'Crestron DIN-8SW8 spec sheet',
  },
  {
    make: 'Crestron', model: 'DIN-2MC2', name: 'DIN rail motor control, 2 channel',
    re: /2mc2/i, kind: 'motor', outputs: 2,
    // rated by motor size (1/2 HP), not by a channel current - nothing claimed
    perOutputA: null, perOutputW: null, totalA: null, source: null,
  },
  {
    make: 'Crestron', model: 'DIN-DLI', name: 'DIN rail DALI interface',
    re: /din-dli|dli/i, kind: 'dali', outputs: 1,
    perOutputA: null, perOutputW: null, totalA: null, source: null,
  },
];

// Who made it. Only the Name carries this - the ref says what the module DOES.
const MAKES = [[/lutron/i, 'Lutron'], [/crestron/i, 'Crestron']];
export const makerOf = (typeRef, name) => {
  const hay = `${name ?? ''} ${typeRef ?? ''}`;
  return MAKES.find(([re]) => re.test(hay))?.[1] ?? null;
};

// 1 DIN module is 17.5mm (page 139763). Lutron quote their 12-module case as
// 216mm, i.e. 18mm each - the difference is the case, not the pitch.
export const DIN_MM = 17.5;

// A module is only matched within its own manufacturer. An unknown maker gets
// nothing: claiming a rating for a module you cannot identify is worse than
// having none, because it reads as checked.
export function matchModule(typeRef, name) {
  const make = makerOf(typeRef, name);
  if (!make) return null;
  const hay = `${typeRef ?? ''} ${name ?? ''}`;
  return MODULES.find((m) => m.make === make && m.re.test(hay)) ?? null;
}

// The limit on one output, by its INDEX in the module's own order.
export function outputLimit(spec, index) {
  if (!spec) return { a: null, w: null };
  const last = (arr) => (arr ? arr[Math.min(index, arr.length - 1)] : null);
  return { a: last(spec.perOutputA), w: last(spec.perOutputW) };
}
