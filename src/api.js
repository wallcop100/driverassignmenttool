// Local, in-browser engine calls behind the same async surface the components
// used when this talked to a Python sidecar. The parsed model is held here so
// validate/eligibility/export keep their original (assignments, added) signatures.
import demoForm from './demo/form.csv?raw';
import demoLinks from './demo/links.csv?raw';
import * as embed from './embed.js';
import * as engine from './engine.js';

let model = null;
// The raw CSVs are kept so the model can be rebuilt when a driver type preset is
// added or changed, without asking for the files again (embedded, there is
// nobody to ask). `applied` is what the current model was built with.
let raw = { form: null, links: null, types: null };
let applied = '[]';

// The one ingest path: everything that produces a model goes through here, so
// the module-level `model` above is always set. Host-posted CSVs (embed mode)
// and dropped files land in the same place.
export function parseText(formText, linksText, typesText) {
  raw = { form: formText, links: linksText, types: typesText };
  applied = '[]';
  model = engine.buildModel(formText, linksText, typesText);
  return model;
}

// Returns a fresh model when the presets differ from the ones already baked in,
// null when there is nothing to do — so the caller can dispatch unconditionally
// without looping.
export function rebuild(presets) {
  const list = Object.values(presets || {});
  const key = JSON.stringify(list);
  if (key === applied || !raw.links) return null;
  model = engine.buildModel(raw.form, raw.links, raw.types, list);
  applied = key;
  return model;
}

// Drop the files at once, autodetect which is which (#10). Links are the only
// hard requirement: links + a driver type library is the greenfield case (no
// drivers yet), links + form is a hub that already has some.
export async function parseAuto(files) {
  const texts = await Promise.all([...files].map((f) => f.text()));
  const found = { form: null, links: null, types: null };
  for (const t of texts) {
    const kind = engine.detectKind(t);
    if (kind) found[kind] = t;
  }
  if (!found.links) throw new Error("Couldn't detect a Links Assignment CSV. Drop that one at least.");
  if (!found.form && !found.types) {
    throw new Error('Links only: add the Driver Assignment CSV, or the driver type library to size new drivers from.');
  }
  return parseText(found.form, found.links, found.types);
}

export function loadDemo() {
  return parseText(demoForm, demoLinks);
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
