// The LCP tool's answers to core/domain.js.
//
// A module's capacity is not a wattage. It is how many of its declared terminals
// are taken, which is a count - so the bars read "3/8 ways", not "136.8/180W".
import { makeDomain } from '../core/domain.js';
import { slotKey } from '../core/nodes.js';
import { buildModel } from './parse.js';
import { matchModule, outputLimit } from './catalogue.js';

// ---- slot kinds ------------------------------------------------------------
// NOTHING in the schema says what kind of slot <LB1> is. It is inferred from the
// name, the way every live panel recipe is written:
//
//   01..12   DIN ways, where modules go
//   LB*      load bar / breaker ways
//   P*       power and processor ways
//
// The inference is a guess and must be shown as one: `certain` is false wherever
// the name does not follow the convention, so the screen can say so rather than
// quietly refusing a drop.
export const SLOT_KINDS = {
  din: { label: 'DIN way', fill: 'processor' },
  loadbar: { label: 'load bar', fill: 'signal' },
  power: { label: 'power', fill: 'psu' },
  unknown: { label: 'way', fill: 'passive' },
};

export function slotKind(name) {
  const k = slotKey(name);
  if (/^\d+$/.test(k)) return { kind: 'din', certain: true };
  if (/^LB/.test(k)) return { kind: 'loadbar', certain: true };
  if (/^P/.test(k)) return { kind: 'power', certain: true };
  return { kind: 'unknown', certain: false };
}

// What a module wants. Same inference problem, same honesty: a type ref that
// says nothing gets 'unknown' and may go anywhere.
export function moduleKind(typeRef) {
  const t = String(typeRef ?? '').toUpperCase();
  if (/PROCESSOR|DIN-HUB|HUB/.test(t)) return 'din';
  if (/LANDING|LB/.test(t)) return 'loadbar';
  if (/^ET-PS|PS-|SUPPLY/.test(t)) return 'power';
  if (/MOD-/.test(t)) return 'din';
  return 'unknown';
}

// A module in a way that is not its kind. Reported, never prevented - the
// inference is a convention, not a schema fact, and fighting a drop over a guess
// is worse than flagging one.
export function slotFault(module, slotName) {
  const want = moduleKind(module?.typeRef);
  const got = slotKind(slotName);
  if (want === 'unknown' || !got.certain || want === got.kind) return null;
  return `${module.typeRef} reads as a ${SLOT_KINDS[want].label}, and ${slotName} is a `
    + `${SLOT_KINDS[got.kind].label}. Slot kind is inferred from the name - nothing in the `
    + 'schema records it - so check this rather than trust it.';
}

// ---- control intent (page 139894) -----------------------------------------
// The LCP analogue of DriverHealthCheck: a DALI loop carries at most 16 control
// groups; a group belongs to ONE loop; a loop is a single control type.
export const DALI_MAX_GROUPS = 16;

// Cables carry a wattage, modules are often rated in amps. 230V is the UK mains
// these panels are on; a project on another voltage needs this told to it.
export const MAINS_V = 230;

export function controlFaults(links) {
  const out = [];
  const loops = new Map();
  const groupLoops = new Map();
  for (const l of links ?? []) {
    if (!l.loop) continue;
    const e = loops.get(l.loop) ?? { groups: new Set(), types: new Set() };
    if (l.controlGroup) e.groups.add(l.controlGroup);
    if (l.controlType) e.types.add(l.controlType);
    loops.set(l.loop, e);
    if (l.controlGroup) {
      (groupLoops.get(l.controlGroup) ?? groupLoops.set(l.controlGroup, new Set()).get(l.controlGroup))
        .add(l.loop);
    }
  }
  for (const [loop, e] of loops) {
    if (e.types.size > 1) {
      out.push({ level: 'FAIL', loop, message: `${loop} mixes control types (${[...e.types].join(', ')}). A loop is one control type.` });
    }
  }
  for (const [group, ls] of groupLoops) {
    if (ls.size > 1) {
      out.push({ level: 'FAIL', group, message: `Control group ${group} is split across ${ls.size} loops (${[...ls].join(', ')}). A group belongs to one loop.` });
    }
  }
  return out;
}

// ---- what KIND of terminal is this? ---------------------------------------
// The mistake worth not repeating: a terminal is not one thing. A dimmer channel
// and a Cresnet branch are both "a terminal", and almost nothing true of one is
// true of the other.
//
//   POWER   L1/N1 on a DIN-1DIMU4 - one line and neutral, one piece of copper,
//           one circuit. Everything landed on it is the same circuit, so a
//           double termination must share its Link_ControlDetails.
//
//   BUS     NET B on a DIN-HUB, L1 on a QSX processor, a DALI loop. A shared
//           segment that MANY devices sit on. Keypads, shade controls and
//           anything else legitimately coexist here, and separate daisy chains
//           landing on one branch is normal wiring, not a fault. What limits it
//           is device count, power budget and cable length - never uniformity.
//
// The tell is the name. `L1/N1` is a line/neutral pair; `L1` on its own is a
// link. Where it cannot be told, nothing is checked.
const POWER_RE = /^\s*L\d+\s*\/\s*N\d+\s*$/i;
const CRESNET_RE = /^(CRESNET|NET(\s|\.|$)|NETHOST|NETPWR)/i;
const QS_RE = /^(QSLINK|QS$|QS[\s.]|LINK|L\d+$)/i;
const DALI_NAME_RE = /^(DALI|DA\d|D\d)/i;
const MAINS_RE = /^\d+V$/i;

// What the MODULE is, from its ref and its name. This has to come before the
// terminal name, because terminal names are wildly inconsistent: the estate's
// most-used DALI module (ET-MOD-DALI, 2302 sets) calls its loops `Output 1` and
// `Output 2`, the Lutron one calls them `1` and `2`, the THEBEN gateway calls
// them `D1` and `D2`, and only ET-LQSE-2DALUNV-D writes `DALI B 1`. Matching on
// the terminal name alone left the common case unclassified and silent.
const MODULE_BUS = [
  [/DALI|DAL\b/i, 'DALI'],
  [/CRESNET|DIN-HUB|HUB\b/i, 'Cresnet'],
  [/QSX|QS-|QSE|HOMEWORKS/i, 'QS'],
];
export const moduleBus = (module) => MODULE_BUS.find(
  ([re]) => re.test(`${module?.typeRef ?? ''} ${module?.name ?? ''}`))?.[1] ?? null;

export function terminalKind(node, module) {
  const n = String(node?.name ?? '').trim();
  const detail = String(node?.detail ?? '');
  // a line-and-neutral pair is a circuit whatever the module is
  if (POWER_RE.test(n)) return { kind: 'power', bus: null };
  // a mains input is neither
  if (MAINS_RE.test(n)) return { kind: 'unknown', bus: null };
  // the upstream link OFF a module is the control bus it hangs from, not one of
  // its own outputs: `>QS` and `LINK` on a DALI module are the QS link
  if (QS_RE.test(n)) return { kind: 'bus', bus: 'QS' };
  if (CRESNET_RE.test(n)) return { kind: 'bus', bus: 'Cresnet' };
  // otherwise a module that IS a bus device gives bus terminals, whatever its
  // own naming happens to be
  const bus = moduleBus(module);
  if (bus) return { kind: 'bus', bus };
  if (DALI_NAME_RE.test(n) || DALI_NAME_RE.test(detail)) return { kind: 'bus', bus: 'DALI' };
  // a dimmer/switch/motor output not named as a pair is still an output
  const k = moduleKind(module?.typeRef);
  if (k === 'din' && /^(0?\d+|M\d+|OP\.?\d+)$/i.test(n)) return { kind: 'power', bus: null };
  return { kind: 'unknown', bus: null };
}

// ---- what a bus segment actually takes ------------------------------------
// REFERENCE ONLY. None of these is a count of cables, and a cable run landing on
// a terminal is not a device on the segment: one run can carry a whole daisy
// chain of keypads, and a DALI loop's 64 is CONTROL GEAR downstream - ballasts - 
// a property of the fittings, not of the wiring at the panel.
//
// So these are shown beside a terminal as context and are never checked against
// a run count. Checking them would be comparing two different quantities and
// calling the answer a fault.
//
//   Cresnet  ~20 devices and 75 W (3.13 A at 24 V) per ISOLATED segment, 914 m
//   QS       99 devices and a PDU budget per link, 610 m
//   DALI     64 ballasts and 16 control groups per LOOP - see loopFaults
export const BUS_LIMITS = {
  Cresnet: { devices: 20, watts: 75, amps: 3.13, volts: 24, metres: 914,
    source: 'Crestron DIN-HUB spec sheet' },
  QS: { devices: 99, pdu: 30, metres: 610, source: 'Lutron HomeWorks QS wiring guidelines' },
  // 64 is the DALI standard's own address limit (short addresses 0-63). It is
  // NOT a house rule: DJ 101269 reports a ballast count and sets no threshold,
  // and the KB documents only the 16-control-group limit (page 139692). So the
  // ballast figure is shown as a gauge and the group count as a fault.
  DALI: { devices: 64, groups: DALI_MAX_GROUPS,
    source: 'DALI address limit 0-63; groups from page 139692' },
};

// ---- how a DALI loop is actually modelled ---------------------------------
// Measured on set 108908, 110 DALI links. A loop is ONE LinksMap link,
// not one per run:
//
//   X504505 "15.1B"   100 ends = 50 from + 50 to,  TopologyNotesText "Loop"
//                     distinct `to` ends: 1 - the module output
//                     distinct ends total: 51 - 50 fittings + the module
//
// So the link converges on a single module output and fans out to the fittings
// on the loop, and its Name is the loop's identity: panel.module + output
// (`15.1B` is panel 15, module .1, output B). The cable TypeRef is
// DALI-PWR-230VAC (230 V and the DALI pair together) or DALI-DATA for data only.
//
// Two consequences for this tool:
//   * a DALI module output normally carries exactly ONE link - the loop
//   * the number worth checking is the fittings ON that loop, which lives in the
//     link's ends, not in how many cables reach the panel. The host has to count
//     it; the payload here carries one panel.
export const DALI_LOOP_TYPES = /^DALI(-|$)/i;

// ---- what a DALI loop takes, per LOOP --------------------------------------
// DJ 101269 "Intermediate Ballast Count Check" is the authority, and it counts
// two things per Link_ControlDetails - never per terminal:
//
//   ballasts  SUM(BallastCountPerUoM x Quantity) over the DALI positions on the
//             loop, plus the driver Elements where the position is fed by a
//             secondary power ref. The tool is sent none of that, so it reports
//             a ballast count only when the host supplies one.
//   groups    COUNT(DISTINCT ControlGroupText) on the loop, EXCLUDING rows whose
//             group name equals the loop name - a group named after its own loop
//             is not a separate group.
//
// A loop spans the whole design: several terminals, several modules, several
// panels. It is not a property of the panel on screen, so this is advisory here
// and authoritative in the DJ.
export function loopFaults(model) {
  const byLoop = new Map();
  for (const l of model?.links ?? []) {
    if (!l.loop) continue;
    const e = byLoop.get(l.loop) ?? { groups: new Set(), ballasts: 0, sawBallasts: false };
    if (l.controlGroup && l.controlGroup !== l.loop) e.groups.add(l.controlGroup);
    if (l.ballasts != null) { e.ballasts += Number(l.ballasts) || 0; e.sawBallasts = true; }
    byLoop.set(l.loop, e);
  }
  const out = [];
  for (const [loop, e] of byLoop) {
    if (e.groups.size > DALI_MAX_GROUPS) {
      out.push({ level: 'FAIL', loop,
        message: `${loop} has ${e.groups.size} control groups - a DALI loop takes ${DALI_MAX_GROUPS} (DJ 101269).` });
    }
    if (e.sawBallasts && e.ballasts > BUS_LIMITS.DALI.devices) {
      out.push({ level: 'WARN', loop,
        message: `${loop} carries ${e.ballasts} ballasts - past the ${BUS_LIMITS.DALI.devices} DALI `
          + 'addresses (0-63). Counted from what the host sent; DJ 101269 is the authority.' });
    }
  }
  return out;
}

// ---- a power output is one circuit ----------------------------------------
// Only for POWER terminals. Two cables may share a dimmer channel - a normal
// double termination - but only if they are the same circuit, because they are
// on the same copper and will always dim together whatever the programming says.
//
// This is NOT applied to a bus: keypads, shade controls and separate daisy
// chains sharing a Cresnet branch or a QS link is exactly how they are wired.
export function terminalLoopFaults(model, assignments) {
  const byRef = new Map((model?.links ?? []).map((l) => [l.ref, l]));
  const nodeOf = new Map();
  for (const mod of model?.drivers ?? []) {
    for (const node of mod.nodes ?? []) nodeOf.set(`${mod.ref}|${node.name}`, { mod, node });
  }
  const out = [];
  for (const [key, entry] of Object.entries(assignments ?? {})) {
    const refs = entry?.refs ?? [];
    if (refs.length < 2) continue;
    const at = nodeOf.get(key);
    if (!at || terminalKind(at.node, at.mod).kind !== 'power') continue;
    const loops = new Set(refs.map((r) => byRef.get(r)?.loop ?? null).filter(Boolean));
    if (loops.size > 1) {
      const [ref, node] = key.split('|');
      out.push({
        level: 'FAIL', driver: ref, node,
        message: `${node} carries ${loops.size} circuits (${[...loops].join(', ')}). `
          + 'A dimmer channel is one line and neutral, so everything on it switches together - '
          + 'a double termination has to share its Link_ControlDetails.',
      });
    }
  }
  return out;
}

// ---- output limits ---------------------------------------------------------
// A phase module can be inside every one of its four channel limits and still be
// over its shared module total. Both are checked, the way a driver's node cap and
// driver total already are. Power terminals only - a bus carries no load.
export function outputFaults(model, assignments) {
  const byRef = new Map((model?.links ?? []).map((l) => [l.ref, l]));
  const watts = (refs) => (refs ?? []).reduce((n, r) => n + (byRef.get(r)?.loadW ?? 0), 0);
  const out = [];
  for (const mod of model?.drivers ?? []) {
    const spec = matchModule(mod.typeRef, mod.name);
    if (!spec) continue;
    outputsOf(mod).forEach((node, i) => {
      if (terminalKind(node, mod).kind !== 'power') return;
      const w = watts(assignments?.[`${mod.ref}|${node.name}`]?.refs);
      if (!w) return;
      const lim = outputLimit(spec, i);
      // Lutron publish a wattage per zone; Crestron publish a current. Check
      // whichever the maker actually states, and say which it was.
      if (lim.w != null && w > lim.w) {
        out.push({ level: 'FAIL', driver: mod.ref, node: node.name,
          message: `${node.name} carries ${w}W - ${spec.make} ${spec.model} channel ${i + 1} takes ${lim.w}W of LED (${lim.a}A).` });
      } else if (lim.w == null && lim.a != null && w / MAINS_V > lim.a) {
        out.push({ level: 'FAIL', driver: mod.ref, node: node.name,
          message: `${node.name} carries ${w}W (${(w / MAINS_V).toFixed(1)}A) - `
            + `${spec.make} ${spec.model} channel ${i + 1} takes ${lim.a}A.` });
      }
    });
  }
  return out;
}

// ---- outputs, not terminals ----------------------------------------------
// A module declares every terminal it has, and not all of them are outputs. A
// Crestron DIN-1DIMU4 is {<L1/N1,<L2/N2,<L3/N3,<L4/N4,>NET}: four dimmed outputs
// and the Cresnet connection it hangs off. Counting all five called a 4-channel
// phase module a 5-way one. The upstream side is the network, link, host, power
// or mains terminal, or anything marked '>' (in).
const UPSTREAM_RE = /^(NET|NETHOST|NETPWR\w*|NET\.MASTER|CRESNET|LINK|QS|QSLINK\d*|ETH\w*|LAN|PWR\d*|\d+V)$/i;
export const isUpstream = (node) => node?.dir === '>' || UPSTREAM_RE.test(String(node?.name ?? '').trim());

// The outputs of a module, in its own order. A module with nothing but upstream
// terminals (a processor) keeps all of them, so it still reads as something.
export function outputsOf(mod) {
  const nodes = mod?.nodes ?? [];
  const outs = nodes.filter((n) => !isUpstream(n));
  return outs.length ? outs : nodes;
}

// Ballasts on the loops landed at one terminal. The host sends the LOOP's total
// on every cable row of that loop, so it is taken once per loop, never summed
// per cable: two cables on the same loop are the same 54 ballasts, not 108.
export function terminalBallasts(links) {
  const perLoop = new Map();
  for (const l of links ?? []) {
    if (l?.ballasts == null) continue;
    perLoop.set(l.loop ?? l.ref, Number(l.ballasts) || 0);
  }
  return perLoop.size ? [...perLoop.values()].reduce((a, b) => a + b, 0) : null;
}

export const lcp = makeDomain({
  id: 'lcp',
  name: 'LCP Assignment Tool',
  msgPrefix: 'lcp',
  storagePrefix: 'lcpassignmenttool',

  // Ways taken against ways declared. A module whose type has no terminal recipe
  // has no capacity to check, which is a sentence rather than an empty bar.
  capacities: (mod, { assignments, links } = {}) => {
    // outputs OCCUPIED, not cables landed and not every terminal declared: three
    // runs on two DALI loops is two outputs used, and a phase module's NET is not
    // one of its four outputs.
    const outs = outputsOf(mod);
    const used = outs.filter(
      (node) => (assignments?.[`${mod.ref}|${node.name}`]?.refs?.length ?? 0) > 0).length;
    const spec = matchModule(mod.typeRef, mod.name);
    const bars = [{
      label: 'outputs',
      used,
      cap: outs.length ? outs.length : null,
      unit: '',
      title: outs.length
        ? `${outs.length} outputs on ${mod.typeRef}${outs.length < (mod.nodes?.length ?? 0)
          ? ` (${mod.nodes.length - outs.length} network or power terminal${mod.nodes.length - outs.length === 1 ? '' : 's'} not counted)` : ''}`
        : `${mod.typeRef} declares no terminal recipe, so nothing can land on it`,
    }];
    // A phase module's four zones SHARE one 10 A module total. Being inside
    // every zone limit does not put you inside it.
    if (spec?.totalA != null) {
      const all = (mod.nodes ?? []).flatMap(
        (n) => assignments?.[`${mod.ref}|${n.name}`]?.refs ?? []);
      // the screens hand links over keyed by ref; the tests hand an array
      const at = (r) => (Array.isArray(links) ? links.find((l) => l.ref === r) : links?.[r]);
      const amps = all.reduce((n, r) => n + ((at(r)?.loadW ?? 0) / MAINS_V), 0);
      bars.push({
        label: 'module total', used: +amps.toFixed(2), cap: spec.totalA, unit: 'A',
        title: `${spec.model} - the zones share one ${spec.totalA}A module total`,
      });
    }
    return bars;
  },

  // One cable per terminal is the normal case, so the per-terminal bar is a
  // count too and anything above one is worth seeing.
  slotCapacities: (mod, node, { count = 0, watts = 0, links = [] } = {}) => {
    const t = terminalKind(node, mod);
    // A bus is not "one cable per terminal" - many devices share it, so the bar
    // is the segment's device allowance, not a 1.
    if (t.kind === 'bus') {
      const lim = BUS_LIMITS[t.bus] ?? {};
      // A DALI loop's fitting count is a real gauge against 64 - but only the
      // host can count it, because the loop's ends run across the whole design
      // and this tool is sent one panel.
      const ballasts = t.bus === 'DALI' ? terminalBallasts(links) : null;
      if (ballasts != null) {
        const devices = ballasts;
        return [{ label: null, used: devices, cap: lim.devices, unit: ' ballasts',
          title: `${devices} ballasts on this loop. 64 is the DALI address limit `
            + '(0-63), not a house rule - DJ 101269 reports the count without a threshold.' }];
      }
      // No cap: a run is not a device, and a DALI loop's 64 is ballasts
      // downstream. The segment's allowance is context, not a bar to fill.
      return [{ label: null, used: count, cap: null, unit: count === 1 ? ' run' : ' runs',
        title: `${t.bus} - ${t.bus === 'DALI'
          ? `${lim.devices} ballasts and ${lim.groups} control groups per loop`
          : `${lim.devices} devices per segment`} (${lim.source}). `
          + 'Runs landing here are a different quantity.' }];
    }
    const bars = [{ label: null, used: count, cap: 1, unit: '',
      title: `${node.name}${node.detail ? ` (${node.detail})` : ''}` }];
    const spec = matchModule(mod.typeRef, mod.name);
    // the limit is per output INDEX among the outputs, not among every terminal
    const index = Math.max(0, outputsOf(mod).findIndex((n) => n.name === node.name));
    const lim = outputLimit(spec, index);
    // zone 1 is not zone 2: the limit is per output INDEX, not per module
    if (lim.w != null) {
      bars.push({ label: null, used: watts, cap: lim.w, unit: 'W',
        title: `${spec.make} ${spec.model}: channel ${index + 1} takes ${lim.w}W of LED (${lim.a}A)` });
    } else if (lim.a != null) {
      bars.push({ label: null, used: +(watts / MAINS_V).toFixed(2), cap: lim.a, unit: 'A',
        title: `${spec.make} ${spec.model}: channel ${index + 1} takes ${lim.a}A` });
    }
    return bars;
  },

  badge: (mod) => {
    const k = moduleKind(mod.typeRef);
    return { kind: k, text: SLOT_KINDS[k]?.label ?? 'module' };
  },

  // Modules are drawn to one width: no module type in the estate declares a
  // [x,,], so sizing them differently would be inventing a difference.
  widthOf: () => 260,

  // Drivers wrap into a grid because a hub is a cupboard and their order says
  // nothing. Modules do not: they sit on a DIN rail in a fixed order, so they
  // are stacked the way the panel stacks them and read top to bottom.
  binLayout: 'column',

  // Link_ControlDetails, not ControlGroup. A panel terminal is a circuit or a
  // bus segment, and both are defined by the loop - the ControlGroup says
  // nothing about what may share a piece of copper.
  groupOf: (link) => link?.loop ?? null,
  groupLabel: 'Link_ControlDetails',
  // a bus segment carries many loops by design; a dimmer channel does not
  slotAllowsManyGroups: (mod, node) => terminalKind(node, mod).kind === 'bus',
  // what a cable block may show on its face
  labelFields: [
    { key: 'ref', label: 'Ref' },
    { key: 'name', label: 'Name' },
    { key: 'loop', label: 'Link_ControlDetails' },
    { key: 'loadW', label: 'Load (W)' },
  ],

  terms: {
    container: 'module', containers: 'modules',
    group: 'panel', groups: 'panels',
    slot: 'terminal', slots: 'terminals',
  },
  // The per-terminal bar already says 0/1; a second figure beside it would be
  // the same fact twice. A terminal detail (DL1) is worth showing instead.
  slotSummary: (mod, node) => node.detail ?? null,
  setupNotice: () => false,
  // a panel's modules are arranged into its ways, which is its layout
  spaceLayout: true,

  slotsOf: (type) => (type?.nodes ?? []).map((n) => n.name),

  // The overlay sends the panel's modules, the cables in it, and the module
  // ElementTypes whose {terminal} recipes say what a cable can land on.
  parseInit: (msg, types) => buildModel(msg.modules, msg.links, types ?? msg.types),

  // Control intent is a property of the CABLES, not of where they land, so it is
  // checked against the links themselves. Slot faults are reported per module by
  // the arrangement surface rather than here.
  validate: async (model, assignments) => ({
    flags: [
      ...controlFaults(model?.links ?? []).map((f) => ({
        level: f.level, message: f.message, loop: f.loop ?? null, group: f.group ?? null,
      })),
      ...loopFaults(model),
      ...terminalLoopFaults(model, assignments),
      ...outputFaults(model, assignments),
    ],
  }),
});

export default lcp;
