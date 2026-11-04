// What we can say about a driver ElementType by comparing what the DesignDB
// states against the datasheet the type's Name matched. No JSX and no React, so
// `node --test` can cover the judgement itself rather than only the screens
// built on it.
import { atCurrent, checkOf, combine, currentFromName, currentFromRef, sharedSupply } from './engine.js';

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
export function faults(t, spec) {
  // A pending fix is what the patch will write, so a type filled in is no longer
  // "to check" (report B3TPLM). Its blanks are still flagged; its disagreements
  // with the spec page are not - that would flag the user's own answer back at them.
  const judgeSpec = !t.preset;
  spec = atCurrent(spec, t.currentA);
  const page = spec?.shared ? 'shared catalogue' : 'spec page';
  const out = [];
  if (t.maxPowerW == null) {
    out.push(['no MaxPower(W) - nothing to size against',
      'Without a max power this type cannot be checked or sized against.']);
  } else if (judgeSpec && spec?.maxPowerW != null && Math.abs(t.maxPowerW - spec.maxPowerW) > 0.01) {
    const times = t.maxPowerW / spec.maxPowerW;
    out.push([`${t.maxPowerW}W here · ${page} says ${fmt(spec.maxPowerW)}W`,
      `This type states ${t.maxPowerW}W. The ${spec.name} ${page} says ${fmt(spec.maxPowerW)}W`
      + `${times >= 1.5 ? ` - ${fmt(times)}× higher, so checks against it would pass an overload` : ''}. `
      + `If this is not a ${spec.name}, the name is what matched it.`, 'disagrees']);
  }
  if (t.powerType == null) {
    out.push(['no CC/CV - matches no cable', 'With no declared CC/CV type this driver matches nothing.']);
  } else if (t.powerType === 'CC' && t.currentA == null) {
    out.push(['no CurrentRange - reads as undeclared',
      'With CurrentRange empty the driver has no declared current, so it matches no cable.']);
  } else if (t.powerType === 'CV' && t.outputVoltageV == null) {
    out.push(['no OutputVoltage(V)', 'Without an output voltage the CV check cannot run.']);
  } else if (judgeSpec && t.powerType === 'CC' && t.currentA != null && spec?.minA != null
    && (t.currentA < spec.minA || t.currentA > spec.maxA)) {
    out.push([`${t.currentA}A · ${page} range is ${spec.minA}–${spec.maxA}A`,
      `${t.currentA}A is outside the ${spec.minA}–${spec.maxA}A the ${spec.name} ${page} gives.`, 'disagrees']);
  }
  return out;
}

// Types whose stated ratings a trusted spec disagrees with - a datasheet, or a
// shared part a second person has checked. An unchecked one is not evidence.
export const disagreeing = (types, resolveSpec) => types.filter((t) => {
  const spec = resolveSpec(t.name || t.typeRef);
  return spec && ![spec.driver ?? spec, spec.supply].some((p) => checkOf(p) === 'unchecked') && faults(t, spec).some((f) => f[2] === 'disagrees');
});

// One line of ratings, from whichever side of a type is being shown.
export const ratingsOf = (t) => [
  t.maxPowerW != null ? `${fmt(t.maxPowerW)}W` : '-',
  t.currentA != null ? `${fmt(t.currentA)}A` : t.outputVoltageV != null ? `${fmt(t.outputVoltageV)}V` : null,
  (t.nodeMaxFvV ?? t.nodes?.[0]?.maxFvV) != null ? `${fmt(t.nodeMaxFvV ?? t.nodes[0].maxFvV)}fV/out` : null,
].filter(Boolean).join(' · ');

// The current the design picked out of the datasheet's range. It says so twice - 
// in the ref and in the name - and when those disagree neither is authoritative,
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

// Whether a spec, or the supply half of a pair, came from the shared catalogue.
export const fromShared = (spec) => !!(spec?.shared || spec?.supply?.shared || spec?.pairedShared);

// The preset a fix would produce. `mode` is 'fill' - add only what the design
// states nothing for - or 'replace', which also overwrites what disagrees.
// Both go through SET_PRESET, so the result is pending and reviewable either way.
export function fixPreset(t, spec, mode, currentA) {
  if (!spec) return null;
  const d = t.designDB ?? t;
  const take = (mine, theirs) => (mode === 'replace' ? theirs ?? mine : mine ?? theirs);
  const a = currentA ?? currentOptions(t, spec)[0]?.a ?? null;
  spec = atCurrent(spec, a);
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
    origin: fromShared(spec) ? 'shared' : 'datasheet',
  };
}

// Which of the two fixes a type can take. Judged against what the card shows - 
// pending preset included - so filling the blanks does not take the other away.
export const canFill = (t, spec) => !!spec && (t.maxPowerW == null || t.powerType == null
  || (spec.powerType === 'CC' && t.currentA == null)
  || (t.nodes?.[0]?.maxFvV == null && spec.maxFvV != null));

// A shared part only ever fills blanks: it never overwrites what the design states.
export const canReplace = (t, spec) => !!spec && !fromShared(spec) && spec.maxPowerW != null && t.maxPowerW != null
  && Math.abs(t.maxPowerW - spec.maxPowerW) > 0.01;

// Everything the datasheet can settle without asking. A type's Name matches a
// part, and the two things a datasheet cannot know are usually already written
// down: the current is in the Ref (ET-CCR-D-350-1CH-01) and the supply is in the
// Name ("LinDrive 200D & Meanwell HLG-185-24"), so resolveSpec has already
// paired them. What is left over is what the wizard has to ask about.
//
// Returns { ready, asks } - ready are types that can be filled in one press.
export function autoFillable(inventory, resolveSpec) {
  const ready = [];
  const asks = [];
  for (const t of inventory ?? []) {
    let spec = resolveSpec(t.name || t.typeRef);
    const part = spec?.driver ?? spec ?? null;
    // no supply in the Name: the one people agreed this driver is usually paired with
    const usual = part?.kind === 'dcdc' && !spec.supply ? sharedSupply(part) : null;
    if (usual) spec = { ...combine(part, usual), pairedShared: true };
    if (!part) { asks.push({ t, spec, why: 'no datasheet match' }); continue; }
    // A supply named on its own IS the driver - an unswitched PSU feeding a tape
    // run directly, one output, ControlType Local, which is how page 140180
    // lists the PCV24100. A supply named ALONGSIDE a DC/DC driver is the other
    // half of a pair, and resolveSpec has already combined the two.
    // a DC/DC driver with no supply named is a pair we cannot complete
    if (part.kind === 'dcdc' && !spec.supply) { asks.push({ t, spec, why: 'which supply?' }); continue; }
    // one person's word: the next person checks it before it fills anything
    if ([part, spec.supply].some((p) => checkOf(p) === 'unchecked')) {
      asks.push({ t, spec, why: 'shared part, not yet checked' });
      continue;
    }
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
  spec = atCurrent(spec, currentA);
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
    origin: fromShared(spec) ? 'shared' : 'datasheet',
  };
}

// ---- families: which product a project's types are, and what that changes ----
// About 90% of a project is the same few products at different currents, so
// the product is identified first and every type of it confirmed in one go.
// What can't be identified with confidence goes to the review, and from there
// to the questions below.

// What a type writes as one of a family. The datasheet wins where it says
// something (a shared part only fills blanks), and Parameters that list more
// than the default OP.1 already say how many outputs there are.
export function familyPreset(t, spec, currentA) {
  const p = fixPreset(t, spec, fromShared(spec) ? 'fill' : 'replace', currentA);
  if ((t.nodes?.length ?? 0) > 1) return p;
  return { ...p, outputs: spec.outputs ?? 1, nodeNames: spec.nodeNames ?? null };
}

// The Name less what tells siblings apart, so types no part is known for still
// group: "TCI MP 32 HV K2 - 350mA" and "- 700mA" are one product, asked about once.
export const nameStem = (name) => String(name ?? '').toLowerCase()
  .replace(/\b(at|set to)?\s*\d{2,4}\s*ma\b/g, '').replace(/\bvariant\s*\d+\b/g, '')
  .replace(/[\s\-–:,]+$/, '').replace(/\s+/g, ' ').trim();

// { families: [{ key, spec, part, supply, types: [{ t, currentA, preset, note }] }],
//   rest: [{ types, spec, why }] }, biggest family first. A part only one other
// person has sent still forms a family: saying yes to it is the second vote (learn.js).
export function identify(types, resolve) {
  const fams = new Map();
  const rest = [];
  const pairs = [];   // DC/DC drivers whose Name names no supply, settled once the families are known
  const join = (spec, t, currentA, note) => {
    const part = spec.driver ?? spec;
    const key = `${part.name}|${spec.supply?.name ?? ''}`;
    if (!fams.has(key)) fams.set(key, { key, spec, part, supply: spec.supply ?? null, types: [] });
    fams.get(key).types.push({ t, currentA, note, preset: familyPreset(t, spec, currentA) });
  };
  const current = (t, spec) => {
    if (spec.powerType !== 'CC') return { a: null };
    const opts = currentOptions(t, spec);
    if (!opts.length) return { why: `Neither the Ref nor the Name gives a current the ${spec.name} can run at.` };
    if (opts.length > 1) return { why: `The Ref says ${fmt(opts[0].a)}A and the Name says ${fmt(opts[1].a)}A.` };
    return { a: opts[0].a };
  };
  const place = (t, spec, note) => {
    const c = current(t, spec);
    if (c.why) rest.push({ types: [t], spec, why: c.why }); else join(spec, t, c.a, note);
  };

  for (const t of types ?? []) {
    const name = t.name || '';
    const spec = name ? resolve(name) : null;
    const part = spec?.driver ?? spec;
    if (!part) { rest.push({ types: [t], spec: null, why: name ? 'No known product has this Name.' : 'It has no Name.' }); continue; }
    // "HLG-185H-24A & LTEC LT-995 DMX Decoder" matches the supply and nothing else
    // the part itself is in doubt in these two, so the questions start without it (spec: null)
    if (/[&+]/.test(name) && (spec.parts?.length ?? 1) < 2) { rest.push({ types: [t], spec: null, why: `The Name names a second product beside the ${part.name}.` }); continue; }
    const outs = (t.nodes?.length ?? 0) > 1 ? t.nodes.length : null;
    if (outs && part.outputs != null && part.outputs !== outs) {
      rest.push({ types: [t], spec: null, why: `Its Parameters give ${outs} outputs, and the ${part.name} has ${part.outputs}.` });
      continue;
    }
    if (part.kind === 'dcdc' && !spec.supply) { pairs.push({ t, part }); continue; }
    place(t, spec);
  }

  // A driver with no supply named runs on the one its siblings name, or the one people agreed
  for (const { t, part } of pairs) {
    const sib = [...fams.values()].find((f) => f.part.name === part.name && f.supply);
    const usual = sharedSupply(part);
    const psu = sib?.supply ?? usual;
    if (psu) place(t, combine(part, psu), `Its supply, ${psu.name}, as ${sib ? 'the other types here have it' : 'people use it'}`);
    else rest.push({ types: [t], spec: part, why: 'Its Name names no supply.' });
  }

  // No Name at all: a guess, when the Ref fits exactly one family
  for (let n = rest.length - 1; n >= 0; n--) {
    const [t] = rest[n].types;
    if (t.name || rest[n].spec) continue;
    const k = known(t);
    const pt = k.powerType?.[0];
    // the Ref itself must say how many outputs: ET-CVR-FEED-PROV says CV and nothing else
    const outs = Number(String(t.typeRef).match(/-(\d)CH\b/i)?.[1]);
    const fits = [...fams.values()].filter((f) => pt && outs && f.spec.powerType === pt
      && (f.part.outputs ?? 1) === outs
      && (pt !== 'CC' || (k.currentA && (f.spec.minA == null
        || (k.currentA[0] >= f.spec.minA && k.currentA[0] <= f.spec.maxA)))));
    if (fits.length !== 1) continue;
    rest.splice(n, 1);
    join(fits[0].spec, t, k.currentA?.[0] ?? null, 'No Name: a guess from the Ref and the other types here');
  }

  // A type with no Name is named the way its siblings are, at its own current
  for (const f of fams.values()) {
    const sib = f.types.find((x) => x.t.name && currentFromName(x.t.name) != null);
    if (!sib) continue;
    for (const x of f.types) {
      if (!x.t.name && x.currentA != null) x.preset = { ...x.preset, name: sib.t.name.replace(NAME_MA_G, `${Math.round(x.currentA * 1000)}mA`) };
    }
  }

  // what is left, one card per product even when no part is known for it
  const grouped = new Map();
  for (const r of rest) {
    const [t] = r.types;
    const key = t.name ? `${r.why}|${nameStem(t.name)}` : `ref|${t.typeRef}`;
    if (grouped.has(key)) grouped.get(key).types.push(t); else grouped.set(key, { ...r, types: [t] });
  }
  return { families: [...fams.values()].sort((a, b) => b.types.length - a.types.length), rest: [...grouped.values()] };
}

const JUDGED = [
  ['powerType', 'PowerType', '', (d) => d.powerType],
  ['maxPowerW', 'Max power', 'W', (d) => d.maxPowerW],
  ['currentA', 'Current', 'A', (d) => d.currentA],
  ['outputVoltageV', 'Output voltage', 'V', (d) => d.outputVoltageV],
  ['nodeMaxFvV', 'Forward voltage', 'V', (d) => d.nodes?.[0]?.maxFvV],
  ['nodeMaxLoadW', 'Power per output', 'W', (d) => d.nodes?.[0]?.maxLoadW],
  ['controlType', 'ControlType', '', (d) => d.controlType],
  ['addresses', 'Addresses', '', (d) => d.ballast],
];

// What a family's preset does to each column the type already has: `fill` a
// blank, or replace a value that `differs` from the datasheet, or is `wrong` -
// beyond what the part can do at all. Columns that agree are left out.
export function judge(t, preset, spec) {
  const d = t.designDB ?? t;
  spec = atCurrent(spec, preset.currentA);
  const out = [];
  for (const [key, col, unit, get] of JUDGED) {
    const was = get(d);
    const now = preset[key];
    if (now == null || now === '') continue;
    if (was == null || was === '') { out.push({ status: 'fill', key, col, now, unit }); continue; }
    const same = typeof now === 'number' ? Math.abs(now - Number(was)) < 0.01 : String(now).toLowerCase() === String(was).toLowerCase();
    if (same) continue;
    const times = key === 'maxPowerW' && spec?.maxPowerW ? Number(was) / spec.maxPowerW : null;
    const wrong = (times != null && times > 1.01)
      || (key === 'currentA' && spec?.minA != null && (was < spec.minA || was > spec.maxA));
    out.push({
      status: wrong ? 'wrong' : 'differs', key, col, was, now, unit,
      hint: times >= 1.5 ? `${fmt(times)}× what the ${spec.name} gives` : null,
    });
  }
  return out;
}

// ---- the setup questions (the wizard's "which driver is this?") ----
// Asked as buttons, one at a time, until one catalogue part is left. What the
// type already says is not asked, and the buttons come in the order this
// project already uses them.

export const QUESTIONS = ['powerType', 'controlType', 'outputs'];

// What the type itself answers, as { key: [value, where] }. Only more than one
// node counts for outputs: a library row with no Node column gets one OP.1 by
// default, which says nothing.
export function known(t) {
  const k = {};
  const ref = String(t.typeRef ?? '');
  const pt = t.powerType ?? (/^ET-CCR/i.test(ref) ? 'CC' : /^ET-CVR/i.test(ref) ? 'CV' : null);
  if (pt) k.powerType = [pt, t.powerType ? 'type' : 'Ref'];
  if (t.controlType) k.controlType = [t.controlType, 'type'];
  const refOuts = Number(ref.match(/-(\d)CH\b/i)?.[1]);
  if ((t.nodes?.length ?? 0) > 1) k.outputs = [t.nodes.length, 'Parameters'];
  else if (refOuts) k.outputs = [refOuts, 'Ref'];
  const a = t.currentA ?? currentFromRef(ref) ?? currentFromName(t.name);
  if (pt === 'CC' && a != null) k.currentA = [a, t.currentA != null ? 'type' : currentFromRef(ref) != null ? 'Ref' : 'Name'];
  return k;
}

// How often this project's filled-in driver types use each answer, keyed by
// question, then value. A type counts once it states anything or is filled in here.
export function precedent(types, resolveSpec) {
  const out = { powerType: {}, controlType: {}, outputs: {}, part: {}, supply: {}, currentA: {} };
  const add = (key, v) => { if (v != null && v !== '') out[key][v] = (out[key][v] ?? 0) + 1; };
  for (const t of types ?? []) {
    if (!t.preset && t.maxPowerW == null && t.currentA == null && t.outputVoltageV == null) continue;
    add('powerType', t.powerType);
    add('controlType', t.controlType);
    add('outputs', t.nodes?.length);
    add('currentA', t.currentA);
    const spec = resolveSpec(t.name || t.typeRef);
    add('part', (spec?.driver ?? spec)?.name);
    add('supply', spec?.supply?.name);
  }
  return out;
}

// The parts still possible. A supply alone is a CV driver too (an unswitched
// PSU feeding tape), so it stays in unless the answer is CC. A suggested part
// may not say its ControlType or outputs; not saying is no reason to drop it.
export const narrow = (parts, ans) => parts.filter((p) => (p.kind !== 'supply' || ans.powerType !== 'CC')
  && (ans.powerType == null || p.powerType === ans.powerType)
  && (ans.controlType == null || p.controlType == null || p.controlType === ans.controlType)
  && (ans.outputs == null || p.outputs == null || p.outputs === ans.outputs)
  && (ans.currentA == null || p.powerType !== 'CC' || p.minA == null
    || (ans.currentA >= p.minA - 1e-9 && ans.currentA <= p.maxA + 1e-9)));

// The next attribute to ask, or null to go to the part buttons. CC/CV first,
// always: everyone can answer it. Then whichever open question best tells the
// parts left apart - the one whose biggest answer leaves the fewest - while
// there are too many to show as buttons.
export function nextQuestion(cands, ans, few = 4) {
  const split = (key) => {
    const groups = {};
    for (const p of cands) if (p[key] != null) groups[p[key]] = (groups[p[key]] ?? 0) + 1;
    return groups;
  };
  if (ans.powerType == null) return { key: 'powerType', groups: split('powerType') };
  if (cands.length <= few) return null;
  let best = null;
  for (const key of QUESTIONS) {
    if (ans[key] != null) continue;
    const groups = split(key);
    if (Object.keys(groups).length < 2) continue;
    const worst = Math.max(...Object.values(groups));
    if (!best || worst < best.worst) best = { key, groups, worst };
  }
  return best && { key: best.key, groups: best.groups };
}
