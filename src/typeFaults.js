// What we can say about a driver ElementType by comparing what the DesignDB
// states against the datasheet the type's Name matched. No JSX and no React, so
// `node --test` can cover the judgement itself rather than only the screens
// built on it.
import { currentFromName, currentFromRef } from './engine.js';

export const fmt = (n) => (n == null ? null : (Number.isInteger(n) ? n : +n.toFixed(2)));

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
