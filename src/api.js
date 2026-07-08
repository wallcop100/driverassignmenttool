// Local, in-browser engine calls behind the same async surface the components
// used when this talked to a Python sidecar. The parsed model is held here so
// validate/eligibility/export keep their original (assignments, added) signatures.
import demoForm from './demo/form.csv?raw';
import demoLinks from './demo/links.csv?raw';
import * as engine from './engine.js';

let model = null;

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
  model = engine.buildModel(formText, linksText);
  return model;
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

function download(text, suggestedName, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = Object.assign(document.createElement('a'), { href: url, download: suggestedName });
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

export async function saveCsv(text, suggestedName) {
  return download(text, suggestedName, 'text/csv');
}
