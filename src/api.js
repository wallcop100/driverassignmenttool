const port = window.desktop?.sidecarPort ?? 5175;
const BASE = `http://127.0.0.1:${port}`;

async function post(path, body, isJson = true) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: isJson ? { 'Content-Type': 'application/json' } : undefined,
    body: isJson ? JSON.stringify(body) : body,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `${path} failed (${res.status})`);
  }
  return res;
}

export async function parse(formFile, linksFile) {
  const fd = new FormData();
  fd.append('form', formFile);
  fd.append('links', linksFile);
  return (await post('/parse', fd, false)).json();
}

export async function validate(assignments, addedDrivers) {
  return (await post('/validate', { assignments, addedDrivers })).json();
}

export async function suggest(linkRef, assignments, addedDrivers) {
  return (await post('/suggest', { linkRef, assignments, addedDrivers })).json();
}

export async function eligibility(zone, assignments, addedDrivers) {
  return (await post('/eligibility', { zone, assignments, addedDrivers })).json();
}

export async function exportCsv(assignments, addedDrivers) {
  return (await post('/export', { assignments, addedDrivers })).text();
}

export async function saveCsv(text, suggestedName) {
  if (window.desktop?.saveFile) return window.desktop.saveFile(text, suggestedName);
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: suggestedName });
  a.click();
  URL.revokeObjectURL(url);
  return true;
}
