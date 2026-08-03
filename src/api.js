// Local, in-browser engine calls behind the same async surface the components
// used when this talked to a Python sidecar. The parsed model is held here so
// validate/eligibility/export keep their original (assignments, added) signatures.
import demoForm from './demo/form.csv?raw';
import demoLinks from './demo/links.csv?raw';
import * as embed from './embed.js';
import * as engine from './engine.js';

let model = null;

// The one ingest path: everything that produces a model goes through here, so
// the module-level `model` above is always set. Host-posted CSVs (embed mode)
// and dropped files land in the same place.
export function parseText(formText, linksText, typesText) {
  model = engine.buildModel(formText, linksText, typesText);
  return model;
}

// Drop both files at once, autodetect which is which (#10).
export async function parseAuto(files) {
  const texts = await Promise.all([...files].map((f) => f.text()));
  let formText = null;
  let linksText = null;
  for (const t of texts) {
    const kind = engine.detectKind(t);
    if (kind === 'form') formText = t;
    else if (kind === 'links') linksText = t;
  }
  if (!formText || !linksText) {
    const missing = !formText ? 'a Driver Assignment CSV' : 'a Links Assignment CSV';
    throw new Error(`Couldn't detect ${missing}. Drop one of each (order doesn't matter).`);
  }
  return parseText(formText, linksText);
}

export function loadDemo() {
  model = engine.buildModel(demoForm, demoLinks);
  return model;
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

export async function exportCsv(assignments, addedDrivers) {
  return engine.exportCsv(model, assignments, addedDrivers);
}

export async function generatePatch(assignments, addedDrivers) {
  return engine.generatePatchScript(model, assignments, addedDrivers);
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
