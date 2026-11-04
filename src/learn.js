// What the companion learns from the answers given while filling in driver types
// (TRACES_PLAN §7). Nothing here is shown and nothing asks: a yes to a family
// built on another project's part is that part's vote, "its own values are
// right" sends a reason code per value, and a type filled in by hand that
// matches no part is sent as a part. Only what those answers produce leaves the
// browser - never a CSV, the session or free text (CLAUDE.md, the hard constraint).
// The builders are pure, so `node --test` covers what would be sent; the senders
// are quiet, and on Pages (no companion) they do nothing.
import { checkOf, combine, resolveSpec, setSharedParts, sharedAmendment } from './catalogue.js';
import { getCompanion } from './companion.js';
import { familyPreset, judge } from './typeFaults.js';

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const numOrNull = (v) => (v === '' || v == null ? null : Number(v));

// The votes already given, by rev: a vote counts once per version, whether it
// came from a family's yes or a pick between the datasheet and a correction.
const KEY = 'dat.sharedCheck';
export const said = () => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}; } catch { return {}; } };
export const remember = (rev, v) => {
  try { localStorage.setItem(KEY, JSON.stringify({ ...said(), [rev]: v })); } catch { /* private window */ }
};

// A part as the companion takes it, from a draft or a preset (field names are the editor's).
export const partFromDraft = (d, { name, aliases, kind, minMa, maxMa, size = [], jboxes = '', psu = '' }) => ({
  name: name.trim(),
  aliases: aliases.split(',').map((a) => a.trim()).filter(Boolean),
  kind, powerType: d.powerType,
  maxPowerW: numOrNull(d.maxPowerW),
  ...(d.powerType === 'CC'
    ? { minA: numOrNull(minMa) == null ? null : numOrNull(minMa) / 1000,
        maxA: numOrNull(maxMa) == null ? null : numOrNull(maxMa) / 1000 }
    : { outputV: numOrNull(d.outputVoltageV) }),
  outputs: Math.max(1, Number(d.outputs) || 1),
  addresses: numOrNull(d.addresses),
  maxFvV: numOrNull(d.nodeMaxFvV),
  nodeMaxLoadW: numOrNull(d.nodeMaxLoadW),
  nodeCurrentA: numOrNull(d.nodeCurrentA),
  controlType: (d.controlType ?? '').trim() || null,
  // what the layout needs to draw it: the case, its boxes, and a DC/DC driver's usual supply
  ...(size.length === 3 && size.every((v) => numOrNull(v) > 0) && { sizeMm: size.map(Number) }),
  ...(numOrNull(jboxes) != null && { jboxes: Math.round(Number(jboxes)) }),
  ...(kind === 'dcdc' && psu && { psu }),
});

// ---- votes ----

// A confirmed row is not voted on, and the sender's own sending was their yes.
const votable = (p) => !!p?.shared && p.shared !== 'confirmed' && typeof p.rev === 'string' && !p.own;

/** The votes a yes ('confirmed') or "it's a different product" ('rejected') casts. */
export const votesFor = (parts, vote, given = said()) => [...new Set(parts)]
  .filter((p) => votable(p) && !given[p.rev])
  .map((p) => ({ name: p.name, rev: p.rev, vote }));

// ---- another project's correction, asked about where the part is used ----

// A correction exists only because someone said the datasheet was wrong
// (ownValues). Until a second person agrees, each value it changes is one row:
// the datasheet's, theirs, or not sure. The pick fills the types and is the vote.
const DISPUTED = [
  ['powerType', 'PowerType', ''],
  ['maxPowerW', 'Max power', 'W'],
  ['current', 'Current', 'A'],
  ['outputV', 'Output voltage', 'V'],
  ['maxFvV', 'Forward voltage', 'V'],
  ['nodeMaxLoadW', 'Power per output', 'W'],
  ['nodeCurrentA', 'Current per output', 'A'],
  ['outputs', 'Outputs', ''],
  ['addresses', 'Addresses', ''],
  ['controlType', 'ControlType', ''],
];
const valueOf = (p, key) => (key !== 'current' ? p[key] : p.minA == null ? null : `${p.minA}–${p.maxA}`);

/**
 * Each value an unchecked correction from another project changes on these
 * datasheet parts: [{ part, rev, key, col, unit, datasheet, theirs }]. A value
 * the datasheet lacks is not a disagreement, and a correction already checked
 * here (`given`, by rev) is not asked about again.
 */
export function disputed(parts, given = said()) {
  const out = [];
  for (const p of new Set(parts.filter(Boolean))) {
    const a = !p.shared && sharedAmendment(p.name);
    if (!a || a.own || !a.rev || checkOf(a) !== 'unchecked' || given[a.rev]) continue;
    for (const [key, col, unit] of DISPUTED) {
      const ds = valueOf(p, key);
      const theirs = valueOf(a, key);
      if (ds == null || theirs == null || String(ds).toLowerCase() === String(theirs).toLowerCase()) continue;
      out.push({ part: p.name, rev: a.rev, key, col, unit, datasheet: ds, theirs });
    }
  }
  return out;
}

export const pickKey = (r) => `${r.part}|${r.key}`;

/** The spec with every value picked as 'theirs' taken from the correction; a pair is combined again. */
export function pickedSpec(spec, rows, picks) {
  if (!spec || !rows.some((r) => picks[pickKey(r)] === 'theirs')) return spec;
  const fix = (p) => {
    if (!p) return p;
    const q = { ...p };
    for (const r of rows) {
      if (r.part !== p.name || picks[pickKey(r)] !== 'theirs') continue;
      if (r.key !== 'current') q[r.key] = r.theirs;
      else ({ minA: q.minA, maxA: q.maxA } = sharedAmendment(p.name));
    }
    return q;
  };
  if (spec.driver && spec.supply) return { ...combine(fix(spec.driver), fix(spec.supply)), parts: spec.parts };
  if (spec.supply && !spec.driver) return { ...fix(spec), supply: fix(spec.supply) };
  return fix(spec);
}

/** A family with its presets written from the picked spec, each keeping the name it was given. */
export function pickedFamily(f, rows, picks) {
  const spec = pickedSpec(f.spec, rows, picks);
  if (spec === f.spec) return f;
  return { ...f, spec, types: f.types.map((x) => ({ ...x, preset: { ...familyPreset(x.t, spec, x.currentA), name: x.preset.name } })) };
}

/** Per correction, the vote its picks make: any datasheet pick says no, all theirs says yes. */
export function pickVotes(rows, picks) {
  const by = new Map();
  for (const r of rows) by.set(r.part, [...(by.get(r.part) ?? []), picks[pickKey(r)]]);
  return [...by].filter(([, v]) => v.every(Boolean)).map(([name, v]) => ({
    name, vote: v.includes('datasheet') ? 'rejected' : v.every((x) => x === 'theirs') ? 'confirmed' : 'unsure',
  }));
}

/** Send what the picks say about each correction, once per version. */
export const votePicks = (rows, picks) => Promise.all(pickVotes(rows, picks)
  .map(({ name, vote: v }) => vote([sharedAmendment(name)], v)));

// ---- "its own values are right" ----

export const REASONS = {
  derated: 'Derated on purpose',
  variant: 'A different variant',
  datasheet: "The datasheet's wrong",
};
/** Which reasons a judged value can take: derated only when the DesignDB's is lower. */
export const reasonsFor = (e) => Object.keys(REASONS)
  .filter((r) => r !== 'derated' || (typeof e.was === 'number' && typeof e.now === 'number' && e.was < e.now));

// Which part a column is the datasheet's word for. In a DC/DC pair the supply
// sets the rail, and the watts when it is the smaller; a per-output wattage
// derived from rail × current is nobody's single value, so it is not amended.
function ownerOf(spec, key) {
  if (!(spec.driver && spec.supply)) return spec.driver ?? spec.supply ?? spec;
  if (key === 'outputVoltageV') return spec.supply;
  if (key === 'maxPowerW') return spec.supply.maxPowerW <= spec.driver.maxPowerW ? spec.supply : spec.driver;
  if (key === 'nodeMaxLoadW' && spec.driver.nodeCurrentA != null) return null;
  return spec.driver;
}

// A part's fields as the server's allowlist (datajoin `_dat_part`) has them.
const NUM = ['maxPowerW', 'minA', 'maxA', 'outputV', 'maxFvV', 'nodeMaxLoadW', 'nodeCurrentA', 'outputs', 'addresses', 'jboxes'];
const asSent = (p) => ({
  name: p.name, powerType: p.powerType, kind: p.kind ?? 'driver',
  ...(typeof p.code === 'string' && { code: p.code }),
  ...(typeof p.controlType === 'string' && { controlType: p.controlType }),
  ...(typeof p.psu === 'string' && { psu: p.psu }),
  ...Object.fromEntries(NUM.filter((k) => Number.isFinite(p[k])).map((k) => [k, p[k]])),
  aliases: (p.aliases ?? []).filter((a) => norm(a) !== norm(p.name)).slice(0, 6),
  ...(p.discontinued === true && { discontinued: true }),
  ...(p.windows?.length && { windows: p.windows.map((w) => ({ ...w })) }),
  ...(Array.isArray(p.sizeMm) && { sizeMm: p.sizeMm }),
});

// The DesignDB's value written into the part, at the current the type runs at
// when the part is rated per current.
function correct(part, key, was, a) {
  const w = a != null && part.windows?.find((x) => Math.abs(x.a - a) < 0.001);
  switch (key) {
    case 'maxPowerW': if (w) w.w = Number(was); else part.maxPowerW = Number(was); break;
    case 'nodeMaxFvV': if (w) w.fv = Number(was); else part.maxFvV = Number(was); break;
    case 'currentA':
      if (part.minA != null) part.minA = Math.min(part.minA, Number(was));
      if (part.maxA != null) part.maxA = Math.max(part.maxA, Number(was));
      break;
    case 'outputVoltageV': part.outputV = Number(was); break;
    case 'nodeMaxLoadW': part.nodeMaxLoadW = Number(was); break;
    case 'addresses': part.addresses = Number(was); break;
    case 'controlType': part.controlType = String(was); break;
    case 'powerType': if (was === 'CC' || was === 'CV') part.powerType = was; break;
    default: break;
  }
}

/**
 * What "its own values are right" sends: per part, a reason code for each value
 * that differs (`{ reason: { name, values: { key: code } } }`), and, where the
 * datasheet is said to be wrong, the part amended with the DesignDB's value. An
 * amendment adds to one sent before for that part when that one is agreed or the
 * sender's own; an unchecked one from someone else is not passed on as their word.
 */
export function ownValues(t, preset, spec, reasons) {
  const byPart = new Map();
  for (const e of judge(t, preset, spec)) {
    const code = reasons[e.key];
    if (e.status === 'fill' || !REASONS[code]) continue;
    const owner = ownerOf(spec, e.key);
    if (!owner?.name) continue;
    if (!byPart.has(owner.name)) byPart.set(owner.name, { owner, values: {}, fixes: [] });
    const b = byPart.get(owner.name);
    b.values[e.key] = code;
    if (code === 'datasheet') b.fixes.push(e);
  }
  return [...byPart.values()].map(({ owner, values, fixes }) => {
    if (!fixes.length) return { reason: { name: owner.name, values } };
    const prior = sharedAmendment(owner.name);
    const part = asSent(owner.shared || !prior || checkOf(prior) === 'unchecked' ? owner : prior);
    for (const e of fixes) correct(part, e.key, e.was, preset.currentA);
    return { part, reason: { name: owner.name, values } };
  });
}

// ---- a type filled in by hand that matches no part ----

// The Name less the current and the variant, keeping its case: the product.
export const productName = (name) => String(name ?? '')
  .replace(/(?:\b(?:at|set to)\s*)?\d{2,4}\s*mA\b/gi, '').replace(/\bvariant\s*\d+\b/gi, '')
  .replace(/[\s\-–:,]+$/, '').replace(/\s+/g, ' ').trim();

/**
 * The part a group of lookalikes filled in by hand makes, or null. `presets` is
 * what was written, one per type: their currents give the range, and watts that
 * change with the current are sent per current.
 */
export function observation(name, presets) {
  const product = productName(name);
  // a product name carries a model number; "LED Driver" alone would match every type that says so
  if (!/\d/.test(product) || norm(product).length < 6 || resolveSpec(name)) return null;
  const [first] = presets;
  const as = [...new Set(presets.map((p) => p.currentA).filter(Number.isFinite))].sort((a, b) => a - b);
  const range = first.powerType === 'CC' && as.length > 1;
  const part = partFromDraft(first, {
    name: product, aliases: '', kind: 'driver',
    minMa: range ? Math.round(as[0] * 1000) : '', maxMa: range ? Math.round(as.at(-1) * 1000) : '',
  });
  const watts = new Map(presets.filter((p) => Number.isFinite(p.currentA) && Number.isFinite(p.maxPowerW))
    .map((p) => [p.currentA, p.maxPowerW]));
  if (range && new Set(watts.values()).size > 1) {
    part.windows = [...watts].map(([a, w]) => ({ a, w })).sort((x, y) => x.a - y.a);
    part.maxPowerW = Math.max(...watts.values());
  }
  // the server takes a field it has or none at all
  return Object.fromEntries(Object.entries(part).filter(([, v]) => v != null));
}

// ---- sending, quietly ----

const parts = async () => (await getCompanion())?.parts ?? null;
const took = (r) => { if (r?.parts) setSharedParts(r.parts); };

/** Cast each vote once, remembering it so nothing asks again. */
export async function vote(list, v) {
  const api = await parts();
  if (!api) return;
  for (const x of votesFor(list, v)) {
    const r = await api.vote(x.name, x.rev, x.vote);
    if (!r.error) { remember(x.rev, x.vote); took(r); }
  }
}

/** Send each body ({part}, {reason}, or both). */
export async function send(bodies) {
  const api = await parts();
  if (!api) return;
  for (const b of bodies) if (b) took(await api.send(b));
}
