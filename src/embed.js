// The only place in the repo that touches postMessage. Keep it small enough to
// read in one sitting — it is the whole trust boundary between us and the host.
//
// Handshake: host iframes /api/?parentOrigin=<its own origin>. We validate that
// claim against a build-time allowlist and then use it as the ONLY targetOrigin
// we will ever post to, and the only origin we will accept messages from.
export const VERSION = 1;

export function isEmbedded() {
  return typeof window !== 'undefined' && window.__DAT_EMBED__ === true && window.self !== window.top;
}

// Pure: no window, no env, no side effects. All the security logic lives here so
// test/embed.test.mjs can cover it under plain `node --test`, no DOM harness.
// Returns { ok } or { ok: false, reason, mismatch? } — callers DROP, never throw,
// and never echo the payload back.
export function validateInit(msg, origin, allowedOrigin) {
  if (!allowedOrigin) return { ok: false, reason: 'no allowed parent origin' };
  if (origin !== allowedOrigin) return { ok: false, reason: 'origin not allowed' };
  if (!msg || typeof msg !== 'object') return { ok: false, reason: 'malformed message' };
  if (msg.type !== 'dat:init') return { ok: false, reason: 'not an init message' };
  // version is checked, not decorative: an unknown version renders an explicit
  // mismatch state rather than guessing at the payload shape.
  if (msg.version !== VERSION) {
    return { ok: false, mismatch: true, reason: `host speaks version ${msg.version}, this build speaks ${VERSION}` };
  }
  if (typeof msg.form !== 'string' || !msg.form.trim()) return { ok: false, reason: 'missing form CSV' };
  if (typeof msg.links !== 'string' || !msg.links.trim()) return { ok: false, reason: 'missing links CSV' };
  return { ok: true };
}

const allowlist = () => String(import.meta.env?.VITE_ALLOWED_PARENT_ORIGINS ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean);

let resolved = null; // '' once we know the claim is bad — never retried
export function parentOrigin() {
  if (resolved === null) {
    const claimed = new URLSearchParams(window.location.search).get('parentOrigin');
    resolved = claimed && allowlist().includes(claimed) ? claimed : '';
  }
  return resolved;
}

// cb(msg, error) — error is a string when a message reached us but failed
// validation in a way worth surfacing (version mismatch). Everything else is
// dropped silently; a page gets plenty of postMessage traffic that isn't ours.
export function onInit(cb) {
  const target = parentOrigin();
  if (!target) { cb(null, 'This tool was opened without a recognised host.'); return () => {}; }
  const handler = (e) => {
    const r = validateInit(e.data, e.origin, target);
    if (r.ok) cb(e.data, null);
    else if (r.mismatch) cb(null, r.reason);
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}

export function send(msg) {
  const target = parentOrigin();
  if (!target) return false;
  window.parent.postMessage({ version: VERSION, ...msg }, target); // never '*'
  return true;
}

export const sendReady = () => send({ type: 'dat:ready' });
export const sendError = (message) => send({ type: 'dat:error', message });
