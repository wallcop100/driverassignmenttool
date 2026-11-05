// Local, in-browser engine calls behind the same async surface the components
// used when this talked to a Python sidecar. The parsed model is held here so
// validate/eligibility/export keep their original (assignments, added) signatures.
// The demo CSVs are bundled by Vite's ?raw, which only a bundler understands - 
// importing them at module scope made this whole file unloadable under plain
// `node --test`, and so made anything that imports it untestable. They are only
// needed when somebody actually clicks Demo, so they are fetched then.
const demo = () => Promise.all([
  import('./demo/form.csv?raw'),
  import('./demo/links.csv?raw'),
  import('./demo/assessment.csv?raw'),
]).then((m) => m.map((x) => x.default));
import * as embed from './embed.js';
import * as engine from './engine.js';
import { isWorkbook, readDesignDb } from './designdb.js';
import { readCsv } from './core/csv.js';
import { parseParams } from './core/params.js';
import { loadDesignDbHandle, saveDesignDbHandle } from './persist.js';

let model = null;
// The raw CSVs are kept so the model can be rebuilt when a driver type preset is
// added or changed, without asking for the files again (embedded, there is
// nobody to ask). `applied` is what the current model was built with.
let raw = { form: null, links: null, types: null, assessment: null, empty: null };
let applied = '[]';
// PositionType -> UoM from the DesignDB, for assessments without a UoM column (DJ 100874)
let ptUom = {};
// assessment row key -> segment lengths, from the DesignDB's Positions
let ptPieces = {};
const withUom = (m) => {
  for (const r of m?.requirements ?? []) {
    if (ptUom[r.positionType]) r.uom = ptUom[r.positionType];
    const p = ptPieces[[r.hubRef, r.cols?.LocationRef, r.controlGroup, r.positionType].join('|')];
    if (p) r.pieces = p;
  }
  return m;
};
// Hub Ref -> hub label, from the host's context: the assessment names a hub by
// its Position Ref, everything else by its label. Empty when standalone.
let zoneAlias = {};
export function setZoneAlias(alias) { zoneAlias = alias || {}; }
// A resumed session's model never went through parsing, so the app hands it over.
export function setModel(m) { model = m; }

// The one ingest path: everything that produces a model goes through here, so
// the module-level `model` above is always set. Host-posted CSVs (embed mode)
// and dropped files land in the same place.
export function parseText(formText, linksText, typesText, assessmentText) {
  raw = { form: formText, links: linksText, types: typesText, assessment: assessmentText };
  applied = '[]';
  model = withUom(engine.buildModel(formText, linksText, typesText, null, assessmentText, zoneAlias));
  return model;
}

// Returns a fresh model when the presets differ from the ones already baked in,
// null when there is nothing to do - so the caller can dispatch unconditionally
// without looping.
export function rebuild(presets) {
  const list = Object.values(presets || {});
  const key = JSON.stringify(list);
  if (key === applied) return null;
  // links + an assessment is one job at two stages, not an estimate-only model
  if (raw.links) model = engine.buildModel(raw.form, raw.links, raw.types, list, raw.assessment, zoneAlias);
  else if (raw.assessment) model = engine.buildEstimate(raw.assessment, raw.types, list, zoneAlias);
  else if (raw.empty) model = engine.buildEmpty(raw.empty, raw.types, list);
  else return null;
  applied = key;
  return withUom(model);
}

// Drop the files at once, autodetect which is which (#10). Three shapes are
// accepted, one per mode: links + form, links + type library, or a requirement
// assessment + type library when there are no links at all.
// A DesignDB workbook stands in for the type library; a type CSV, being from a
// commit, wins over it when both are dropped.
export async function parseAuto(files) {
  watchDesignDb(null);
  const all = [...files];
  const texts = await Promise.all(all.filter((f) => !isWorkbook(f)).map((f) => f.text()));
  const found = { form: null, links: null, types: null, assessment: null };
  for (const t of texts) {
    const kind = engine.detectKind(t);
    if (kind) found[kind] = t;
  }
  const book = all.find(isWorkbook);
  ptUom = {};
  ptPieces = {};
  setDriverExtras();
  const db = book ? await readDesignDb(book) : null;
  if (db) {
    found.types ??= db.types;
    ptUom = db.uom;
    ptPieces = db.pieces;
    setDriverExtras({ compositions: db.compositions, elements: db.hubs });
  }
  // the DesignDB alone: its hubs, their drivers and stored layouts, for the space layout
  if (db && !texts.length) {
    const hubs = Object.keys(db.hubs).sort();
    if (!hubs.length) throw new Error(`${book.name} has no hubs: no Position holds a driver or is named as a Link_SecondaryPowerRef.`);
    return parseEmpty(hubs, found.types);
  }
  // The circumstance decides the mode, not which file happened to be dropped: a
  // links CSV with a header and no rows is a hub with no cables, which is the
  // estimate's case and not an error.
  const hasLinks = found.links && engine.detectKind(found.links) === 'links'
    && engine.buildModel(null, found.links, found.types ?? 'ElementTypeRef,Name\nX,\n').links.length > 0;

  if (found.assessment && !hasLinks) {
    if (!found.types) {
      throw needsTypes('The assessment needs driver types to size against.');
    }
    return parseEstimate(found.assessment, found.types);
  }
  if (!hasLinks) {
    throw new Error(found.links
      ? 'That Links Assignment CSV has no cables in it. For a hub with no cables, run DJ 100053 and drop the assessment instead.'
      : "Couldn't detect a Links Assignment CSV, or a Requirement Assessment. Drop one of those.");
  }
  if (!found.form && !found.types) {
    throw needsTypes('Cables but no drivers: add the Driver Assignment CSV, or driver types to size new drivers from.');
  }
  return parseText(found.form, found.links, found.types, found.assessment);
}

// An embedded hub with nothing in it yet: the host sends neither links nor an
// assessment, only which hub it is.
export function parseEmpty(zone, typesText) {
  raw = { form: null, links: null, types: typesText, assessment: null, empty: zone };
  applied = '[]';
  model = engine.buildEmpty(zone, typesText);
  return model;
}

// Missing only the type library: the import screen keeps what was dropped and
// asks for the DesignDB, rather than starting over.
function needsTypes(message) {
  return Object.assign(new Error(message), { code: 'needs-types' });
}

// The type library arriving after the model was built - a DesignDB attached from
// the app. Rebuilt as if it had been dropped with the CSVs.
export async function attachDesignDb(file, presets, handle = null) {
  const db = await readDesignDb(file);
  ({ types: raw.types, uom: ptUom, pieces: ptPieces } = db);
  if (!embed.isEmbedded()) setDriverExtras({ compositions: db.compositions, elements: db.hubs });
  // opened from the DesignDB alone, so a save may have added or removed a hub
  if (Array.isArray(raw.empty)) raw.empty = Object.keys(db.hubs).sort();
  applied = null;
  watchDesignDb(file, handle);
  return rebuild(presets);
}

// The workbook the types came from, so a save in Excel while the tool is open
// can be offered as a refresh. A dropped file in Chromium brings a handle that
// reads the file as it is now; a picked one is a snapshot.
let source = null;
export function watchDesignDb(file, handle = null) {
  source = file ? { file, handle, at: file.lastModified } : null;
  saveDesignDbHandle(handle ? { handle, at: file.lastModified } : null);
}
// After a reload: the handle saved with the session, compared against the save it was read at.
// Given the resumed model, returns a copy with UoMs and segments from the DesignDB as it is now
// (a session saved by an older build has neither), or null when the workbook can't be read.
export async function resumeDesignDb(resumed = null) {
  const v = await loadDesignDbHandle();
  source = v?.handle ? { file: null, handle: v.handle, at: v.at } : null;
  // the hub rows aren't in the session, so read them back while the handle still may
  if (!source || embed.isEmbedded() || (await v.handle.queryPermission?.({ mode: 'read' })) !== 'granted') return;
  try {
    const db = await readDesignDb(await v.handle.getFile());
    setDriverExtras({ compositions: db.compositions, elements: db.hubs });
    ({ uom: ptUom, pieces: ptPieces } = db);
    if (resumed?.requirements) return withUom({ ...resumed, requirements: resumed.requirements.map((r) => ({ ...r })) });
  } catch { /* unreadable now: the refresh banner takes it from here */ }
  return null;
}
// A handle restored after a reload needs the user's say-so (a click) before it reads again.
export async function allowDesignDb(handle) {
  return (await handle.requestPermission?.({ mode: 'read' })) === 'granted';
}
// Not now: ask again only on the next save (a snapshot can't tell saves apart, so it stops asking).
export function skipDesignDbChange(change) {
  if (source && change?.file) source.at = change.file.lastModified;
  else source = null;
}
// null while unchanged; { file } to re-read, or { file: null } when the browser
// can tell it changed but cannot read the new one (pick it again).
export async function designDbChange() {
  if (!source) return null;
  try {
    if (source.handle) {
      const perm = await source.handle.queryPermission?.({ mode: 'read' });
      if (perm && perm !== 'granted') return { file: null, handle: source.handle, ask: true };
      const f = await source.handle.getFile();
      return f.lastModified !== source.at ? { file: f, handle: source.handle } : null;
    }
    await source.file.slice(0, 1).arrayBuffer();
    return null;
  } catch (e) {
    // shortcut: a snapshot File refusing to read is Chromium's only change signal without a handle; Firefox gives none
    return !source.handle && e?.name === 'NotReadableError' ? { file: null } : null;
  }
}

// Third mode: Positions rolled up by DJ 100053, no links and no drivers.
export function parseEstimate(assessmentText, typesText) {
  raw = { form: null, links: null, types: typesText, assessment: assessmentText };
  applied = '[]';
  model = withUom(engine.buildEstimate(assessmentText, typesText, null, zoneAlias));
  return model;
}

export async function estimate(opts, zone) {
  return engine.estimate(model, opts, zone);
}

// Other hubs of this branch+set, from their saved slots, each with its own
// forced types - so one patch can carry several hubs (E7P24F).
export async function estimateHubs(sessions, opts) {
  return sessions.flatMap((s) => engine.estimate(s.model, { ...opts, forced: s.forcedTypes ?? {} }));
}


// The demo carries all three modes at once, because a real job does: most hubs
// designed, HUB-B1 cabled but with no drivers, and HUB-J still at tender.
export function loadDemo() {
  return demo().then(([form, links, assessment]) => parseText(form, links, null, assessment));
}

export async function validate(assignments, addedDrivers, opts) {
  return { flags: engine.validate(model, assignments, addedDrivers, opts) };
}

export async function eligibility(zone, assignments, addedDrivers) {
  return engine.eligibility(model, zone, assignments, addedDrivers);
}

export async function distribute(assignments, addedDrivers, linkRefs, nodeKeys) {
  return engine.distributeGroup(model, assignments, addedDrivers, linkRefs, nodeKeys);
}

export async function plan(zone, assignments, addedDrivers, opts) {
  return engine.planDrivers(model, assignments, addedDrivers, zone, opts);
}

export async function exportCsv(assignments, addedDrivers) {
  return engine.exportCsv(model, assignments, addedDrivers);
}

// `context` carries the host's hubRef - Elements.ContextRef needs the Position
// Ref, and the CSVs only ever carry the label.
export async function generatePatch(assignments, addedDrivers, presets, context, deletedDrivers, fixNodeSyntax) {
  return engine.generatePatchScriptMulti([{
    model, assignments, addedDrivers, presets: Object.values(presets || {}), context,
    deletedDrivers, fixNodeSyntax,
  }]);
}

// One script covering every hub saved in this branch+set. The hub on screen is
// autosaved on every change, so its stored slot is already current.
export async function generatePatchAll(sessions) {
  return engine.generatePatchScriptMulti(sessions);
}

function download(text, suggestedName, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: suggestedName });
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

// Both delivery paths branch here rather than at the call sites, so the
// components stay embed-unaware. Embedded, a Blob a.click() download is blocked
// by Chrome in a sandboxed cross-origin iframe (sometimes silently) and
// navigator.clipboard needs allow="clipboard-write" - so hand the text to the
// host over the return channel and let it deal with the browser.
export async function saveCsv(text, suggestedName) {
  if (embed.isEmbedded()) {
    return embed.send({ type: embed.topic('export'), kind: 'csv', filename: suggestedName, content: text });
  }
  return download(text, suggestedName, 'text/csv');
}

// The patch is an ExcelScript macro a human pastes into the Office Scripts
// editor - standalone that means the clipboard, not a file.
export async function copyPatch(text) {
  if (embed.isEmbedded()) {
    return embed.send({ type: embed.topic('export'), kind: 'patch', filename: 'DriverAssignmentPatch.osts', content: text });
  }
  await navigator.clipboard.writeText(text);
  return true;
}

// The [w,h,d] each ElementType already states, from the type library the host
// sent. A size in the workbook is the design's own and wins over a datasheet
// figure, so the space layout draws from this first. Empty when the host sent no
// Parameters column, which is every host before DJ 101681 V1.7.
export function typeSizes() {
  if (!raw?.types?.trim()) return {};
  const { rows, fields } = readCsv(raw.types, [], 'Types', true);
  if (!fields.includes('Parameters')) return {};
  const out = {};
  for (const r of rows) {
    const size = parseParams(r.Parameters).size;
    const ref = String(r.ElementTypeRef ?? r.Ref ?? '').trim();
    if (ref && size?.[0] > 0 && size?.[1] > 0) out[ref] = size;
  }
  return out;
}

// IsTBC / IsPropertiesTBC as the DB has them: on the type library (DJ 101681
// V1.8) and on the hub's Elements (its datb_ block, posted as msg.tbc). Only
// refs with a flag set are returned. Empty from older hosts.
let tbcText = null;
export const setTbcText = (text) => { tbcText = text ?? null; };
const truthy = (v) => /^(1|true|yes|y)$/i.test(String(v ?? '').trim());

export function tbcFlags() {
  const out = {};
  const take = (text, name, refOf, sheet) => {
    if (!text?.trim()) return;
    const { rows, fields } = readCsv(text, [], name, true);
    if (!fields.includes('IsTBC') && !fields.includes('IsPropertiesTBC')) return;
    for (const r of rows) {
      const ref = String(refOf(r) ?? '').trim();
      const f = { sheet, isTBC: truthy(r.IsTBC), isPropertiesTBC: truthy(r.IsPropertiesTBC) };
      if (ref && (f.isTBC || f.isPropertiesTBC)) out[ref] = f;
    }
  };
  take(raw?.types, 'Types', (r) => r.ElementTypeRef ?? r.Ref, 'ET');
  take(tbcText, 'TBC', (r) => r.ElementRef, 'E');
  return out;
}

// A driver's parts and each driver Element's own Parameters (DJ 101681 V1.9:
// datc_ and date_ blocks). Both are empty from older hosts.
let partsText = null;
let elementText = null;
export const setDriverExtras = ({ compositions = null, elements = null } = {}) => {
  partsText = compositions ?? null;
  elementText = elements ?? null;
};

// { [wrapperTypeRef]: [{ typeRef, quantity }] }, in the recipe's order.
export function compositions() {
  if (!partsText?.trim()) return {};
  const { rows } = readCsv(partsText, [], 'Compositions', true);
  const out = {};
  for (const r of [...rows].sort((a, b) => (Number(a.SortOrder) || 0) - (Number(b.SortOrder) || 0))) {
    const parent = String(r.ParentTypeRef ?? '').trim();
    const child = String(r.ChildTypeRef ?? '').trim();
    if (!parent || !child) continue;
    (out[parent] ??= []).push({ typeRef: child, quantity: Number(r.Quantity) || 1 });
  }
  return out;
}

// What the hub already states, from the date_ block: the hub row (its bays and
// their sizes), any bay separated into an Element, and every driver's placement,
// as-placed size and junction boxes. This is what lets a layout saved by the
// patch be drawn again with nothing from the session.
// Embedded, the host sends the one hub's rows; from a DesignDB they come per hub label.
export function hubRows(hub = null) {
  const out = { hub: null, bays: [], elements: {} };
  const text = typeof elementText === 'string' ? elementText : elementText?.[hub];
  if (!text?.trim()) return out;
  const { rows } = readCsv(text, [], 'Hub rows', true);
  for (const r of rows) {
    const row = {
      ref: String(r.Ref ?? r.ElementRef ?? '').trim(),
      contextRef: String(r.ContextRef ?? '').trim() || null,
      parameters: String(r.Parameters ?? ''),
      contextParameters: String(r.ContextParameters ?? ''),
      typeRef: String(r.TypeRef ?? '').trim() || null,
      name: String(r.Name ?? ''),
      // one row standing for several drivers, as early designs record them
      quantity: Number(r.Quantity) > 0 ? Number(r.Quantity) : 1,
    };
    if (!row.ref) continue;
    const kind = String(r.Kind ?? 'element').trim().toLowerCase();
    if (kind === 'hub') out.hub = row;
    else if (kind === 'bay') out.bays.push(row);
    else out.elements[row.ref] = row;
  }
  return out;
}

// { [elementRef]: Parameters }
export const elementParams = () => Object.fromEntries(Object.values(hubRows().elements)
  .filter((e) => e.parameters).map((e) => [e.ref, e.parameters]));

// { [typeRef]: { name, params, outputVoltageV } } from the type library.
export function typeInfo() {
  if (!raw?.types?.trim()) return {};
  const { rows } = readCsv(raw.types, [], 'Types', true);
  const out = {};
  for (const r of rows) {
    const ref = String(r.ElementTypeRef ?? r.Ref ?? '').trim();
    if (!ref || out[ref]) continue;
    const v = Number.parseFloat(r['OutputVoltage(V)']);
    out[ref] = { name: String(r.ElementTypeName ?? r.Name ?? ''), params: String(r.Parameters ?? ''), outputVoltageV: Number.isFinite(v) ? v : null };
  }
  return out;
}
