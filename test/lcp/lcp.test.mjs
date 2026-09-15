// The LCP domain, against the real shape of set 109311: panel E08001 is an
// ET-LCP5-Panel declaring <01..08,08a,08b,LB1,LB2,P1,P2,P3> and holding 13
// modules, none of which carry a slot.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildModel } from '../../src/lcp/parse.js';
import lcp, { slotKind, moduleKind, slotFault, controlFaults, DALI_MAX_GROUPS } from '../../src/lcp/domain.js';

const RECIPE = '<01,02,03,04,05,06,07,08,08a,08b,LB1,LB2,P1,P2,P3>';
const MODULES = `ElementRef,ElementTypeRef,ElementName,PanelRef,PanelTypeRef,PanelParameters,ContextParameters
E08002,ET-MOD-DALI,,E08001,ET-LCP5-Panel,"${RECIPE}",
E08009,ET-PROCESSOR-C,,E08001,ET-LCP5-Panel,"${RECIPE}",
E08011,ET-PS-CRESTRON,,E08001,ET-LCP5-Panel,"${RECIPE}",
E08013,ET-LANDINGBOARD,,E08001,ET-LCP5-Panel,"${RECIPE}",<LB1>
`;
const TYPES = `Ref,Name,Parameters
ET-MOD-DALI,Lutron DALI module,"{<A(DL1),<B(DL2),>NET}"
ET-PROCESSOR-C,Crestron processor,"{>NET,>PWR}"
ET-PS-CRESTRON,Crestron PSU,"{<OP.1,<OP.2}"
`;
const LINKS = `LinkRef,PanelRef,ToElementRef,ToNode,ControlGroup,Loop,ControlType
C001,E08001,E08002,A,G1,L1,DALI
C002,E08001,E08002,B,G2,L1,DALI
C003,E08001,,,G3,L1,DALI
`;

test('a panel reads as a container of modules with terminals', () => {
  const m = buildModel(MODULES, LINKS, TYPES);
  assert.deepEqual(m.zones, ['E08001']);
  assert.equal(m.panels[0].slots.length, 15, 'the recipe declares 15 ways');
  assert.equal(m.drivers.length, 4);

  const dali = m.drivers.find((x) => x.ref === 'E08002');
  assert.deepEqual(dali.nodes.map((n) => n.name), ['A', 'B', 'NET']);
  assert.equal(dali.nodes[0].detail, 'DL1', 'the terminal detail survives');
  assert.equal(dali.slot, null, 'nobody has slotted it — that is the work');
  assert.equal(m.drivers.find((x) => x.ref === 'E08013').slot, 'LB1');
});

test('a module type with no terminal recipe is undetermined, not a crash', () => {
  const m = buildModel(MODULES, LINKS, TYPES);
  const board = m.drivers.find((x) => x.ref === 'E08013');
  assert.equal(board.undetermined, true, 'ET-LANDINGBOARD declares nothing');
  assert.deepEqual(board.nodes, []);
  const [cap] = lcp.capacities(board, { assignments: {} });
  assert.equal(cap.cap, null, 'no capacity to check');
  assert.match(cap.title, /declares no terminal recipe/);
});

test('the baseline is what the design already says, so a finished panel is clean', () => {
  const m = buildModel(MODULES, LINKS, TYPES);
  assert.deepEqual(m.baseline['E08002|A'].refs, ['C001']);
  assert.deepEqual(m.baseline['E08002|B'].refs, ['C002']);
  assert.equal(Object.keys(m.baseline).length, 2, 'C003 lands nowhere yet');
});

test('capacity is ways taken against ways declared, not watts', () => {
  const m = buildModel(MODULES, LINKS, TYPES);
  const dali = m.drivers.find((x) => x.ref === 'E08002');
  const [cap] = lcp.capacities(dali, { assignments: m.baseline });
  assert.equal(cap.cap, 3);
  assert.equal(cap.used, 2);
  assert.equal(cap.unit, ' ways');
});

test('slot kind is inferred from the name, and says when it is guessing', () => {
  assert.deepEqual(slotKind('01'), { kind: 'din', certain: true });
  assert.deepEqual(slotKind('8'), { kind: 'din', certain: true });
  assert.deepEqual(slotKind('LB1'), { kind: 'loadbar', certain: true });
  assert.deepEqual(slotKind('P3'), { kind: 'power', certain: true });
  assert.deepEqual(slotKind('08a'), { kind: 'din', certain: true }, 'numeric head wins');
  assert.equal(slotKind('WEIRD').certain, false, 'and an unknown name admits it');
});

test('a module in the wrong kind of way is flagged, never prevented', () => {
  assert.equal(moduleKind('ET-MOD-DALI'), 'din');
  assert.equal(moduleKind('ET-PS-CRESTRON'), 'power');
  assert.equal(slotFault({ typeRef: 'ET-MOD-DALI' }, '01'), null, 'a DIN module in a DIN way');
  const bad = slotFault({ typeRef: 'ET-PS-CRESTRON' }, '01');
  assert.match(bad, /reads as a power/);
  assert.match(bad, /inferred from the name/, 'and says the rule is a guess');
  assert.equal(slotFault({ typeRef: 'ET-UNKNOWN-THING' }, '01'), null, 'no guess, no fault');
});

test('a DALI loop is counted per LOOP, the way DJ 101269 counts it', () => {
  const many = Array.from({ length: DALI_MAX_GROUPS + 1 }, (_, i) => (
    { loop: 'L1', controlGroup: `G${i}`, controlType: 'DALI' }));
  assert.match(loopFaults({ links: many })[0].message, /has 17 control groups/);
  assert.deepEqual(loopFaults({ links: many.slice(0, DALI_MAX_GROUPS) }), []);

  // DJ 101269 excludes a group named after its own loop — it is not a separate
  // group, and counting it would report a fault one short of the real limit
  const named = [...many.slice(0, DALI_MAX_GROUPS),
    { loop: 'L1', controlGroup: 'L1', controlType: 'DALI' }];
  assert.deepEqual(loopFaults({ links: named }), []);

  // ballasts are only reported when the host actually sends a count
  assert.deepEqual(loopFaults({ links: [{ loop: 'L1', controlGroup: 'G1' }] }), [],
    'no ballast data, no ballast claim');
  const over = loopFaults({ links: [{ loop: 'L1', ballasts: 40 }, { loop: 'L1', ballasts: 30 }] });
  assert.match(over[0].message, /carries 70 ballasts — past the 64 DALI addresses/);
  assert.match(over[0].message, /DJ 101269 is the authority/);
  assert.equal(over[0].level, 'WARN', '64 is the DALI spec, not a house rule');
});

test('control intent: the remaining rules from page 139894', () => {
  // a loop is one control type
  const mixed = controlFaults([
    { loop: 'L1', controlGroup: 'G1', controlType: 'DALI' },
    { loop: 'L1', controlGroup: 'G1', controlType: 'PHASE' },
  ]);
  assert.match(mixed[0].message, /mixes control types/);

  // a group belongs to one loop
  const split = controlFaults([
    { loop: 'L1', controlGroup: 'G1', controlType: 'DALI' },
    { loop: 'L2', controlGroup: 'G1', controlType: 'DALI' },
  ]);
  assert.ok(split.some((f) => /split across 2 loops/.test(f.message)));
});

// ---- the terminal is the circuit -------------------------------------------
import { terminalLoopFaults, outputFaults } from '../../src/lcp/domain.js';
import { matchModule, outputLimit, MODULES as LUTRON } from '../../src/lcp/catalogue.js';

// a dimmer channel, named the way Crestron name one
const POWER_MOD = { ref: 'E1', typeRef: 'ET-MOD-PHASE', name: 'Crestron - DIN-1DIMU4',
  nodes: [{ name: 'L1/N1' }, { name: 'L2/N2' }] };
const withLinks = (links) => ({ links, drivers: [POWER_MOD] });

test('two cables may share a dimmer channel, but only if they are one circuit', () => {
  const model = withLinks([
    { ref: 'C1', loop: 'L1' }, { ref: 'C2', loop: 'L1' }, { ref: 'C3', loop: 'L2' },
  ]);
  // a double termination on one loop is normal wiring
  assert.deepEqual(terminalLoopFaults(model, { 'E1|L1/N1': { refs: ['C1', 'C2'] } }), []);
  // two loops on one terminal is not: it is one piece of copper
  const bad = terminalLoopFaults(model, { 'E1|L1/N1': { refs: ['C1', 'C3'] } });
  assert.equal(bad.length, 1);
  assert.equal(bad[0].node, 'L1/N1');
  assert.match(bad[0].message, /carries 2 circuits \(L1, L2\)/);
  assert.match(bad[0].message, /share its Link_ControlDetails/);
  // one cable can never disagree with itself
  assert.deepEqual(terminalLoopFaults(model, { 'E1|L1/N1': { refs: ['C3'] } }), []);
  // and a cable with no loop stated is not evidence of a second one
  assert.deepEqual(terminalLoopFaults(withLinks([{ ref: 'C1', loop: 'L1' }, { ref: 'C2' }]),
    { 'E1|L1/N1': { refs: ['C1', 'C2'] } }), []);
});

test('a limit is claimed only when the maker is known — the project 5294 trap', () => {
  // project 5294 writes ET-MOD-PHASE for a CRESTRON DIN-1DIMU4. Matching on the
  // ref alone gave it Lutron's 400W zone limits; it is rated 5A a channel.
  assert.equal(matchModule('ET-MOD-PHASE', 'Crestron - DIN-1DIMU4').model, 'DIN-1DIMU4');
  assert.deepEqual(outputLimit(matchModule('ET-MOD-PHASE', 'Crestron - DIN-1DIMU4'), 0),
    { a: 5, w: null });
  assert.equal(matchModule('ET-MOD-SWITCH', 'Crestron - DIN-8SW8-I').outputs, 8);
  // the same ref with a Lutron name is the Lutron part
  assert.equal(matchModule('ET-MOD-PHASE', 'Lutron PRO LED+ LQSE-4A5-230-D').model,
    'LQSE-4A5-230-D');
  // and a module whose maker cannot be told is given nothing at all
  assert.equal(matchModule('ET-MOD-PHASE', ''), null);
  assert.equal(matchModule('ET-PS-CRESTRON', 'Crestron - DIN-PWS60'), null,
    'a PSU is not a rated output module');
});

test('Lutron output limits are per zone INDEX, not per module', () => {
  const phase = matchModule('ET-MOD-PHASE', 'Lutron LQSE-4A5-230-D');
  assert.equal(phase.model, 'LQSE-4A5-230-D');
  // zone 1 takes nearly twice what zones 2-4 take
  assert.deepEqual(outputLimit(phase, 0), { a: 1.7, w: 400 });
  assert.deepEqual(outputLimit(phase, 1), { a: 1.0, w: 250 });
  assert.deepEqual(outputLimit(phase, 3), { a: 1.0, w: 250 });
  // switching is 10A a zone and the zones are independent — no module total
  const sw = matchModule('ET-MOD-SWITCH', 'Lutron LQSE-4S10-D');
  assert.equal(sw.model, 'LQSE-4S10-D');
  assert.equal(sw.totalA, null);
  assert.equal(outputLimit(sw, 0).a, 10);
  // a module whose limit Lutron do not publish claims nothing
  assert.equal(outputLimit(matchModule('ET-MOD-MOTOR', 'Lutron LQSE-4M-D'), 0).w, null);
  assert.equal(matchModule('ET-NOT-A-LUTRON-THING', 'Someone else'), null);
});

test('a zone over its limit is caught, and zone 1 is judged by its own figure', () => {
  const model = {
    links: [{ ref: 'C1', loadW: 300 }, { ref: 'C2', loadW: 300 }],
    drivers: [{ ref: 'E1', typeRef: 'ET-MOD-PHASE', name: 'Lutron LQSE-4A5-230-D',
      nodes: [{ name: 'L1/N1' }, { name: 'L2/N2' }, { name: 'L3/N3' }, { name: 'L4/N4' }] }],
  };
  // 300W on zone 1 is fine (400W); the same 300W on zone 2 is not (250W)
  assert.deepEqual(outputFaults(model, { 'E1|L1/N1': { refs: ['C1'] } }), []);
  const bad = outputFaults(model, { 'E1|L2/N2': { refs: ['C2'] } });
  assert.equal(bad.length, 1);
  assert.match(bad[0].message, /carries 300W — Lutron LQSE-4A5-230-D channel 2 takes 250W/);
});

test('the zones share a module total, so passing every zone is not passing', () => {
  const phase = LUTRON.find((m) => m.kind === 'phase');
  assert.equal(phase.totalA, 10);
  // 4 zones at their own limits: 1.7 + 1.0 + 1.0 + 1.0 = 4.7A, inside 10A
  const sum = phase.perOutputA.reduce((a, b) => a + b, 0);
  assert.ok(sum < phase.totalA, 'the zone limits alone cannot reach the module total');
  // so the module bar has to be drawn from the cables, not from the limits
  const [ways, total] = lcp.capacities(
    { ref: 'E1', typeRef: 'ET-MOD-PHASE', name: 'Lutron LQSE-4A5-230-D',
      nodes: [{ name: 'L1/N1' }, { name: 'L2/N2' }] },
    { assignments: { 'E1|L1/N1': { refs: ['C1'] } }, links: [{ ref: 'C1', loadW: 2300 }] });
  assert.equal(ways.unit, ' ways');
  assert.equal(total.cap, 10);
  assert.equal(total.unit, 'A');
  assert.equal(total.used, 10, '2300W at 230V is 10A');
});

// ---- a bus is not a power output -------------------------------------------
// The rule that was wrong: several loops landing on one Cresnet branch or one QS
// link is exactly how these systems are wired. Keypads, shade controls and
// separate daisy chains coexist on a shared segment.
import { terminalKind, loopFaults, BUS_LIMITS } from '../../src/lcp/domain.js';

const HUB = { ref: 'E08010', typeRef: 'ET-CRESTRON-DIN-HUB', name: 'Crestron - DIN-HUB',
  nodes: [{ name: 'NET A' }, { name: 'NET B' }, { name: 'NET C' }] };

test('a terminal is classified before any rule is applied to it', () => {
  const dim = { typeRef: 'ET-MOD-PHASE', name: 'Crestron - DIN-1DIMU4' };
  // line/neutral pairs are power; a bare L1 is a link
  assert.equal(terminalKind({ name: 'L1/N1' }, dim).kind, 'power');
  assert.equal(terminalKind({ name: 'L8/N8' }, dim).kind, 'power');
  assert.deepEqual(terminalKind({ name: 'L1' }, { typeRef: 'ET-MOD-QSX-PROC-2' }),
    { kind: 'bus', bus: 'QS' });
  assert.deepEqual(terminalKind({ name: 'NET B' }, HUB), { kind: 'bus', bus: 'Cresnet' });
  assert.deepEqual(terminalKind({ name: 'CRESNET' }, HUB), { kind: 'bus', bus: 'Cresnet' });
  assert.deepEqual(terminalKind({ name: 'QSLink1' }, {}), { kind: 'bus', bus: 'QS' });
  assert.equal(terminalKind({ name: 'A', detail: 'DA1' }, {}).bus, 'DALI');
  assert.equal(terminalKind({ name: 'DALI B 1' }, {}).bus, 'DALI');
  // and something it cannot place is left alone
  assert.equal(terminalKind({ name: 'PWR24' }, {}).kind, 'unknown');
});

test('several loops on one Cresnet branch is normal wiring, not a fault', () => {
  // the real case: NET B on project 5294 carries Keypad loop 1, Turn loop 1 and
  // Keypad loop 2. All three belong there.
  const model = {
    drivers: [HUB],
    links: [{ ref: 'X215', loop: 'Keypad loop 1' }, { ref: 'X234', loop: 'Turn loop 1' },
      { ref: 'X238', loop: 'Keypad loop 2' }],
  };
  const assignments = { 'E08010|NET B': { refs: ['X215', 'X234', 'X238'] } };
  assert.deepEqual(terminalLoopFaults(model, assignments), [],
    'a bus carries many circuits by design');
});

test('a run landing on a bus is never checked against a device count', () => {
  // 20 Cresnet devices, 99 QS devices, 64 DALI ballasts — none of them is a
  // count of cables, and one run can carry a whole daisy chain
  assert.equal(BUS_LIMITS.Cresnet.devices, 20);
  assert.equal(BUS_LIMITS.Cresnet.watts, 75, '3.13A at 24V, per isolated segment');
  assert.equal(BUS_LIMITS.QS.devices, 99);
  assert.equal(BUS_LIMITS.DALI.devices, 64, 'ballasts downstream, not cables here');

  const many = Array.from({ length: 40 }, (_, i) => ({ ref: `X${i}`, loop: `loop ${i}` }));
  const model = { drivers: [HUB], links: many };
  const assignments = { 'E08010|NET B': { refs: many.map((l) => l.ref) } };
  assert.deepEqual(lcp.capacities(HUB, { assignments }).filter((c) => c.cap === 20), [],
    'no bar is capped at a device count');
  const [bar] = lcp.slotCapacities(HUB, { name: 'NET B' }, { count: 40 });
  assert.equal(bar.cap, null, 'a bus run count has no cap to fill');
  assert.match(bar.title, /different quantity/);
});


test('an output limit is never applied to a bus terminal', () => {
  // a Cresnet branch carries no lighting load, so a wattage on it means nothing
  const model = { drivers: [HUB], links: [{ ref: 'X1', loadW: 5000 }] };
  assert.deepEqual(outputFaults(model, { 'E08010|NET B': { refs: ['X1'] } }), []);
});

// ---- DALI modules: the estate names their loops six different ways ---------
// Measured across all live sets. Classifying on the terminal NAME alone left the
// most-used module of the lot silently unclassified.
test('every DALI module in the estate gives DALI loops, however it names them', () => {
  const real = [
    ['ET-MOD-DALI', 'Universal DALI Power Module', ['Output 1', 'Output 2'], 2302],
    ['ET-MOD-DALI-LUTRON', 'Lutron LQSE-2DALUNV-D', ['1', '2'], 400],
    ['ET-DALI-MOD', 'THEBEN S128 KNX DALI-Gateway', ['D1', 'D2'], 45],
    ['ET-LQSE-2DALUNV-D', 'Lutron DALI module', ['DALI B 1', 'DALI B 2'], 34],
    ['ET-LQSE-1DAL2-D', 'Lutron - DALI Module', ['DA1'], 19],
    ['ET-MOD-DAL', 'Lutron - LQSE-2DALUNV-D - Universal DALI Module', ['DA1', 'DA2'], 2],
  ];
  for (const [typeRef, name, nodes] of real) {
    for (const n of nodes) {
      assert.deepEqual(terminalKind({ name: n }, { typeRef, name }),
        { kind: 'bus', bus: 'DALI' }, `${typeRef} ${n}`);
    }
  }
});

test('a DALI module upstream link is the QS link, not one of its loops', () => {
  // {<DALI B 1,<DALI B 2,>QS} — the last one is how the module hangs off the
  // processor, and it has the QS link's limits, not DALI's
  const m = { typeRef: 'ET-LQSE-2DALUNV-D', name: 'Lutron DALI module' };
  assert.deepEqual(terminalKind({ name: 'QS' }, m), { kind: 'bus', bus: 'QS' });
  assert.deepEqual(terminalKind({ name: 'LINK' },
    { typeRef: 'ET-MOD-DALI-LUTRON', name: 'Lutron LQSE-2DALUNV-D' }),
  { kind: 'bus', bus: 'QS' });
  // and a mains input is neither a loop nor a link
  assert.equal(terminalKind({ name: '230V' },
    { typeRef: 'ET-DALI-MOD', name: 'THEBEN S128 KNX DALI-Gateway' }).kind, 'unknown');
});

test('a DALI terminal carries no lighting load and no run cap', () => {
  const m = { ref: 'E1', typeRef: 'ET-MOD-DALI', name: 'Universal DALI Power Module',
    nodes: [{ name: 'Output 1' }, { name: 'Output 2' }] };
  // several loops on one DALI output is normal — it is a bus
  const model = { drivers: [m], links: [{ ref: 'A', loop: 'DA1' }, { ref: 'B', loop: 'DA2' }] };
  const assignments = { 'E1|Output 1': { refs: ['A', 'B'] } };
  assert.deepEqual(terminalLoopFaults(model, assignments), []);
  // and a wattage on it means nothing
  assert.deepEqual(outputFaults({ drivers: [m], links: [{ ref: 'A', loadW: 4000 }] },
    { 'E1|Output 1': { refs: ['A'] } }), []);
});

test('the module bar counts ways occupied, not cables landed', () => {
  // a DALI module with three runs across its two loops is 2 of 2 ways used —
  // counting cables made it read 3/2 and fail
  const m = { ref: 'E1', typeRef: 'ET-MOD-DALI', name: 'Universal DALI Power Module',
    nodes: [{ name: 'Output 1' }, { name: 'Output 2' }] };
  const [ways] = lcp.capacities(m, { assignments: {
    'E1|Output 1': { refs: ['A', 'B'] }, 'E1|Output 2': { refs: ['C'] },
  } });
  assert.equal(ways.used, 2);
  assert.equal(ways.cap, 2);
  // and one empty loop reads as one way used
  const [half] = lcp.capacities(m, { assignments: { 'E1|Output 1': { refs: ['A', 'B'] } } });
  assert.equal(half.used, 1);
});

// ---- a DALI loop is ONE link -----------------------------------------------
// Measured on set 108908: X504505 "15.1B" is a single link with 100 ends —
// 50 fittings converging on one module output, TopologyNotesText "Loop".
test('a DALI output gauges the ballasts on its loop, not the cables at the panel', () => {
  const m = { ref: 'E1', typeRef: 'ET-MOD-DALI', name: 'Universal DALI Power Module',
    nodes: [{ name: 'Output 1' }] };
  // no count from the host: a run tally with no cap, because runs are not ballasts
  const [plain] = lcp.slotCapacities(m, { name: 'Output 1' }, { count: 1 });
  assert.equal(plain.cap, null);
  assert.match(plain.unit, /run/);
  // the host counts the loop's ends: now it is a real gauge
  const [gauge] = lcp.slotCapacities(m, { name: 'Output 1' }, { count: 1, devices: 50 });
  assert.equal(gauge.used, 50);
  assert.equal(gauge.cap, 64);
  assert.equal(gauge.unit, ' ballasts');
  // and 50 of 64 is the real set 108908 figure — comfortably inside
  assert.ok(gauge.used < gauge.cap);
  const over = lcp.slotCapacities(m, { name: 'Output 1' }, { count: 1, devices: 70 });
  assert.ok(over[0].used > over[0].cap, 'and a loop over 64 shows as over');
});
