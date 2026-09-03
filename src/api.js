// Local, in-browser engine calls behind the same async surface the components
// used when this talked to a Python sidecar. The parsed model is held here so
// validate/eligibility/export keep their original (assignments, added) signatures.
import demoForm from './demo/form.csv?raw';
import demoAssessment from './demo/assessment.csv?raw';
import demoLinks from './demo/links.csv?raw';
import * as embed from './embed.js';
import * as engine from './engine.js';

let model = null;
// The raw CSVs are kept so the model can be rebuilt when a driver type preset is
// added or changed, without asking for the files again (embedded, there is
// nobody to ask). `applied` is what the current model was built with.
let raw = { form: null, links: null, types: null, assessment: null };
let applied = '[]';

// The one ingest path: everything that produces a model goes through here, so
// the module-level `model` above is always set. Host-posted CSVs (embed mode)
// and dropped files land in the same place.
export function parseText(formText, linksText, typesText, assessmentText) {
  raw = { form: formText, links: linksText, types: typesText, assessment: assessmentText };
  applied = '[]';
  model = engine.buildModel(formText, linksText, typesText, null, assessmentText);
  return model;
}

// Returns a fresh model when the presets differ from the ones already baked in,
// null when there is nothing to do — so the caller can dispatch unconditionally
// without looping.
export function rebuild(presets) {
  const list = Object.values(presets || {});
  const key = JSON.stringify(list);
  if (key === applied) return null;
  // links + an assessment is one job at two stages, not an estimate-only model
  if (raw.links) model = engine.buildModel(raw.form, raw.links, raw.types, list, raw.assessment);
  else if (raw.assessment) model = engine.buildEstimate(raw.assessment, raw.types, list);
  else return null;
  applied = key;
  return model;
}

// Drop the files at once, autodetect which is which (#10). Three shapes are
// accepted, one per mode: links + form, links + type library, or a requirement
// assessment + type library when there are no links at all.
export async function parseAuto(files) {
  const texts = await Promise.all([...files].map((f) => f.text()));
  const found = { form: null, links: null, types: null, assessment: null };
  for (const t of texts) {
    const kind = engine.detectKind(t);
    if (kind) found[kind] = t;
  }
  // The circumstance decides the mode, not which file happened to be dropped: a
  // links CSV with a header and no rows is a hub with no cables, which is the
  // estimate's case and not an error.
  const hasLinks = found.links && engine.detectKind(found.links) === 'links'
    && engine.buildModel(null, found.links, found.types ?? 'ElementTypeRef\nX\n').links.length > 0;

  if (found.assessment && !hasLinks) {
    if (!found.types) {
      throw new Error('The assessment needs the driver type library alongside it, to size against.');
    }
    return parseEstimate(found.assessment, found.types);
  }
  if (!hasLinks) {
    throw new Error(found.links
      ? 'That Links Assignment CSV has no cables in it. For a hub with no cables, run DJ 100053 and drop the assessment instead.'
      : "Couldn't detect a Links Assignment CSV, or a Requirement Assessment. Drop one of those.");
  }
  if (!found.form && !found.types) {
    throw new Error('Links only: add the Driver Assignment CSV, or the driver type library to size new drivers from.');
  }
  return parseText(found.form, found.links, found.types);
}

// Third mode: Positions rolled up by DJ 100053, no links and no drivers.
export function parseEstimate(assessmentText, typesText) {
  raw = { form: null, links: null, types: typesText, assessment: assessmentText };
  applied = '[]';
  model = engine.buildEstimate(assessmentText, typesText);
  return model;
}

export async function estimate(opts, zone) {
  return engine.estimate(model, opts, zone);
}

export async function generateEstimatePatch(opts, zone) {
  return engine.generateEstimatePatch(engine.estimate(model, opts, zone));
}

// The demo carries all three modes at once, because a real job does: most hubs
// designed, HUB-B1 cabled but with no drivers, and HUB-J still at tender.
export function loadDemo() {
  return parseText(demoForm, demoLinks, null, demoAssessment);
}

export async function validate(assignments, addedDrivers) {
  return { flags: engine.validate(model, assignments, addedDrivers) };
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

export async function generatePatch(assignments, addedDrivers, presets) {
  return engine.generatePatchScript(model, assignments, addedDrivers, Object.values(presets || {}));
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
// navigator.clipboard needs allow="clipboard-write" — so hand the text to the
// host over the return channel and let it deal with the browser.
export async function saveCsv(text, suggestedName) {
  if (embed.isEmbedded()) {
    return embed.send({ type: 'dat:export', kind: 'csv', filename: suggestedName, content: text });
  }
  return download(text, suggestedName, 'text/csv');
}

// The patch is an ExcelScript macro a human pastes into the Office Scripts
// editor — standalone that means the clipboard, not a file.
export async function copyPatch(text) {
  if (embed.isEmbedded()) {
    return embed.send({ type: 'dat:export', kind: 'patch', filename: 'DriverAssignmentPatch.osts', content: text });
  }
  await navigator.clipboard.writeText(text);
  return true;
}
