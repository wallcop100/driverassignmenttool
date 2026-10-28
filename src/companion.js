// An optional service beside the app, discovered at run time. The app is complete
// without one: on GitHub Pages `companion/capabilities` is a 404 (or index.html),
// every caller gets null, and the bug reporter saves locally as it always has.
// Self-hosted, the same build finds it and reports are sent instead.
//
//   reports   POST companion/reports - one report (bugReports.js buildRemoteReport shape)
//   parts     GET|POST companion/parts - the shared driver catalogue (catalogue.js setSharedParts)
//
// Not at `./api/`: that is the embed entry for DJ 101681. Every call is relative to
// the site root, so the build knows nothing about who answers, and failures are quiet:
// a companion that is down is the same as none.
import { useEffect, useState } from 'react';

export const PROTOCOL = 'dat-companion/1';

// The site root from any of the three entries: /, /api/, /lcp/api/.
export const companionBase = (href) => {
  const dir = new URL('.', href);
  dir.pathname = dir.pathname.replace(/(?:lcp\/)?api\/$/, '');
  return new URL('companion/', dir).href;
};

async function getJson(url, init) {
  const res = await fetch(url, { ...init, headers: { Accept: 'application/json', ...(init?.headers || {}) } });
  // a static host may answer every path with index.html - that is "no companion", not data
  if (!(res.headers.get('content-type') || '').includes('application/json')) return { res, body: null };
  return { res, body: await res.json().catch(() => null) };
}

const quiet = (p) => p.then(({ res, body }) => (res.ok ? body : null)).catch(() => null);

function build(base, features) {
  return {
    features,
    /** One report -> { received, id } | null. */
    report: features.has('reports') ? (r) => quiet(getJson(`${base}reports`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(r),
    })) : null,
    /** The shared catalogue: list() -> { parts } | null; add(part) -> { parts } | { error }. */
    parts: features.has('parts') ? {
      list: () => quiet(getJson(`${base}parts`)),
      add: (part) => getJson(`${base}parts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ part }),
      }).then(({ res, body }) => (res.ok && body ? body : { error: body?.message ?? 'Not sent' }))
        .catch(() => ({ error: 'Not sent' })),
      /** A person's check of the version they were shown -> { parts } | { error }. */
      vote: (name, rev, vote) => getJson(`${base}parts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vote: { name, rev, vote } }),
      }).then(({ res, body }) => (res.ok && body ? body : { error: body?.message ?? 'Not sent' }))
        .catch(() => ({ error: 'Not sent' })),
    } : null,
  };
}

let probe = null;

/** -> the companion API, or null when this build is served without one. Probed once. */
export function getCompanion(href = window.location.href) {
  if (!probe) {
    const base = companionBase(href);
    probe = getJson(`${base}capabilities`)
      .then(({ res, body }) => (res.ok && body?.protocol === PROTOCOL
        ? build(base, new Set(Array.isArray(body.features) ? body.features : [])) : null))
      .catch(() => null);
  }
  return probe;
}

/** Tests only: forget the probe. */
export const resetCompanion = () => { probe = null; };

/** React: the companion, or null (also null until the probe answers). */
export function useCompanion() {
  const [api, setApi] = useState(null);
  useEffect(() => {
    let live = true;
    getCompanion().then((c) => { if (live) setApi(c); });
    return () => { live = false; };
  }, []);
  return api;
}
