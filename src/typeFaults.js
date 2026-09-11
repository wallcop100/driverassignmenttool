// What we can say about a driver ElementType by comparing what the DesignDB
// states against the datasheet the type's Name matched. No JSX and no React, so
// `node --test` can cover the judgement itself rather than only the screens
// built on it.
import { currentFromName, currentFromRef } from './engine.js';

export const fmt = (n) => {
  if (n == null || n === '') return null;
  // Anything that is not a number comes back as it went in. It used to reach
  // toFixed and throw, so one ControlType of "DALI" in a preview took the whole
  // page down.
  if (typeof n !== 'number') return Number.isFinite(Number(n)) && String(n).trim() !== ''
    ? fmt(Number(n)) : n;
  if (!Number.isFinite(n)) return null;
  return Number.isInteger(n) ? n : +n.toFixed(2);
};

// What the stated ratings and the spec page disagree about. The part is matched
// on a free-text name, so a mismatch might be the match's fault rather than the
// data's: attribute the number to the page instead of asserting it. Each entry
// is [what the card shows, the full sentence on hover].
export function faults(type, spec) {
  // Judge the design's own numbers. A preset is a proposal, and flagging it
  // would be flagging the user's own unsaved answer back at them.
  const t = type.designDB ?? type;
  const out = [];
  if (t.maxPowerW == null) {
    out.push(['no MaxPower(W) — nothing to size against',
      'Without a max power this type cannot be checked or sized against.']);
  } else if (spec?.maxPowerW != null && Math.abs(t.maxPowerW - spec.maxPowerW) > 0.01) {
    const times = t.maxPowerW / spec.maxPowerW;
    out.push([`${t.maxPowerW}W here · spec page says ${fmt(spec.maxPowerW)}W`,
      `This type states ${t.maxPowerW}W. The ${spec.name} spec page says ${fmt(spec.maxPowerW)}W`
      + `${times >= 1.5 ? ` — ${fmt(times)}× higher, so checks against it would pass an overload` : ''}. `
      + `If this is not a ${spec.name}, the name is what matched it.`]);
  }
  if (t.powerType == null) {
    out.push(['no CC/CV — matches no cable', 'With no declared CC/CV type this driver matches nothing.']);
  } else if (t.powerType === 'CC' && t.currentA == null) {
    out.push(['no CurrentRange — reads as undeclared',
      'With CurrentRange empty the driver has no declared current, so it matches no cable.']);
  } else if (t.powerType === 'CV' && t.outputVoltageV == null) {
    out.push(['no OutputVoltage(V)', 'Without an output voltage the CV check cannot run.']);
  } else if (t.powerType === 'CC' && t.currentA != null && spec?.minA != null
    && (t.currentA < spec.minA || t.currentA > spec.maxA)) {
    out.push([`${t.currentA}A · spec page range is ${spec.minA}–${spec.maxA}A`,
      `${t.currentA}A is outside the ${spec.minA}–${spec.maxA}A the ${spec.name} spec page gives.`]);
  }
  return out;
}

// One line of ratings, from whichever side of a type is being shown.
export const ratingsOf = (t) => [
  t.maxPowerW != null ? `${fmt(t.maxPowerW)}W` : '—',
  t.currentA != null ? `${fmt(t.currentA)}A` : t.outputVoltageV != null ? `${fmt(t.outputVoltageV)}V` : null,
  (t.nodeMaxFvV ?? t.nodes?.[0]?.maxFvV) != null ? `${fmt(t.nodeMaxFvV ?? t.nodes[0].maxFvV)}fV/out` : null,
].filter(Boolean).join(' · ');

// A type can be in a dozen hubs; a card must not stretch to name them all.
export const zoneList = (zones) => {
  const z = [...zones].sort();
  return z.length > 2 ? `${z[0]} +${z.length - 1}` : z.join(', ');
};

// The current the design picked out of the datasheet's range. It says so twice —
// in the ref and in the name — and when those disagree neither is authoritative,
// so both are offered and the choice corrects the name to match. The ref is left
// alone: it is the key Elements point at and the key the patch writes against,
// so renaming it is a DesignDB migration, not a menu item.
export function currentOptions(t, spec) {
  if (spec?.powerType !== 'CC') return [];
  const fromRef = currentFromRef(t.typeRef);
  const fromName = currentFromName(t.name);
  const inRange = (a) => a != null && (spec.minA == null || (a >= spec.minA && a <= spec.maxA));
  if (spec.minA != null && spec.minA === spec.maxA) return [{ a: spec.minA, from: 'spec page' }];
  const out = [];
  if (inRange(fromRef)) out.push({ a: fromRef, from: 'ref' });
  if (inRange(fromName) && fromName !== fromRef) out.push({ a: fromName, from: 'name' });
  return out;
}

const NAME_MA_G = /\d{2,4}\s*mA/i;

// The preset a fix would produce. `mode` is 'fill' — add only what the design
// states nothing for — or 'replace', which also overwrites what disagrees.
// Both go through SET_PRESET, so the result is pending and reviewable either way.
export function fixPreset(t, spec, mode, currentA) {
  if (!spec) return null;
  const d = t.designDB ?? t;
  const take = (mine, theirs) => (mode === 'replace' ? theirs ?? mine : mine ?? theirs);
  const a = currentA ?? currentOptions(t, spec)[0]?.a ?? null;
  // Aligning the name to the chosen current is safe; aligning the ref is not.
  const name = a != null && currentFromName(t.name) != null && currentFromName(t.name) !== a
    ? String(t.name).replace(NAME_MA_G, `${Math.round(a * 1000)}mA`)
    : t.name || spec.name;
  return {
    typeRef: t.typeRef, name, powerType: spec.powerType,
    maxPowerW: take(d.maxPowerW, spec.maxPowerW),
    currentA: spec.powerType === 'CC' ? take(d.currentA, a) : null,
    outputVoltageV: spec.powerType === 'CV' ? take(d.outputVoltageV, spec.outputV) : null,
    outputs: d.nodes?.length ?? spec.outputs ?? 1,
    addresses: take(d.ballast, spec.addresses),
    nodeMaxLoadW: take(d.nodes?.[0]?.maxLoadW, spec.nodeMaxLoadW),
    nodeMaxFvV: take(d.nodes?.[0]?.maxFvV, spec.maxFvV),
    nodeCurrentA: take(d.nodeCurrentA, spec.nodeCurrentA),
    controlType: take(d.controlType, spec.controlType),
    nodeNames: d.nodes?.map((n) => n.name) ?? null,
    invented: false,
  };
}

// Which of the two fixes a type can take. Judged against what the card shows —
// pending preset included — so filling the blanks does not take the other away.
export const canFill = (t, spec) => !!spec && (t.maxPowerW == null || t.powerType == null
  || (spec.powerType === 'CC' && t.currentA == null)
  || (t.nodes?.[0]?.maxFvV == null && spec.maxFvV != null));

export const canReplace = (t, spec) => !!spec && spec.maxPowerW != null && t.maxPowerW != null
  && Math.abs(t.maxPowerW - spec.maxPowerW) > 0.01;

// Everything the datasheet can settle without asking. A type's Name matches a
// part, and the two things a datasheet cannot know are usually already written
// down: the current is in the Ref (ET-CCR-D-350-1CH-01) and the supply is in the
// Name ("LinDrive 200D & Meanwell HLG-185-24"), so resolveSpec has already
// paired them. What is left over is what the wizard has to ask about.
//
// Returns { ready, asks } — ready are types that can be filled in one press.
export function autoFillable(inventory, resolveSpec) {
  const ready = [];
  const asks = [];
  for (const t of inventory ?? []) {
    const spec = resolveSpec(t.name || t.typeRef);
    const part = spec?.driver ?? spec ?? null;
    if (!part) { asks.push({ t, spec, why: 'no datasheet match' }); continue; }
    // A supply named on its own IS the driver — an unswitched PSU feeding a tape
    // run directly, one output, ControlType Local, which is how page 140180
    // lists the PCV24100. A supply named ALONGSIDE a DC/DC driver is the other
    // half of a pair, and resolveSpec has already combined the two.
    // a DC/DC driver with no supply named is a pair we cannot complete
    if (part.kind === 'dcdc' && !spec.supply) { asks.push({ t, spec, why: 'which supply?' }); continue; }
    let currentA = null;
    if (spec.powerType === 'CC') {
      const opts = currentOptions(t, spec);
      if (!opts.length) { asks.push({ t, spec, why: 'which current?' }); continue; }
      // The Ref and the Name each name a current, and they do not always agree:
      // ET-CCR-D-350-1CH-01 is called "SOLODrive 360/A, set to 500mA" on branch
      // 10568. Taking the Ref silently would write one of them into the DesignDB
      // and bury the disagreement, so it is asked about instead.
      if (opts.length > 1) {
        asks.push({ t, spec, why: `Ref says ${opts[0].a}A, Name says ${opts[1].a}A` });
        continue;
      }
      currentA = opts[0].a;
    }
    ready.push({ t, spec, currentA });
  }
  return { ready, asks };
}

// The preset autoFillable's `ready` entry becomes. Ratings from the datasheet,
// the Ref and the node names left exactly as the design has them.
export function fillFromSpec({ t, spec, currentA }) {
  return {
    typeRef: t.typeRef,
    name: t.name || spec.name,
    powerType: spec.powerType,
    maxPowerW: spec.maxPowerW ?? null,
    currentA: spec.powerType === 'CC' ? currentA : null,
    outputVoltageV: spec.powerType === 'CV' ? spec.outputV ?? null : null,
    outputs: spec.outputs ?? t.nodes?.length ?? 1,
    addresses: spec.addresses ?? t.ballast ?? null,
    nodeMaxLoadW: spec.nodeMaxLoadW ?? null,
    nodeMaxFvV: spec.maxFvV ?? null,
    nodeCurrentA: spec.nodeCurrentA ?? null,
    controlType: spec.controlType ?? null,
    nodeNames: spec.nodeNames ?? null,
    invented: false,
  };
}
