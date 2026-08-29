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
  const env = validateEnvelope(msg, origin, allowedOrigin, 'dat:init');
  if (!env.ok) return env;
  // form is optional: a hub with no drivers yet has no Driver Assignment rows to
  // send. Links OR an assessment is the payload — a hub with no cables at all is
  // sized from its Positions instead (DJ 100053), and a dat:init carrying
  // neither says nothing.
  if (msg.form != null && typeof msg.form !== 'string') return { ok: false, reason: 'malformed form CSV' };
  if (msg.assessment != null && typeof msg.assessment !== 'string') {
    return { ok: false, reason: 'malformed assessment CSV' };
  }
  const hasLinks = typeof msg.links === 'string' && msg.links.trim();
  const hasAssessment = typeof msg.assessment === 'string' && msg.assessment.trim();
  if (!hasLinks && !hasAssessment) return { ok: false, reason: 'missing links CSV' };
  if (msg.links != null && typeof msg.links !== 'string') return { ok: false, reason: 'malformed links CSV' };
  return { ok: true };
}

// The driver type library, sent once before dat:init. Same envelope rules.
export function validateTypes(msg, origin, allowedOrigin) {
  const env = validateEnvelope(msg, origin, allowedOrigin, 'dat:types');
  if (!env.ok) return env;
  if (typeof msg.types !== 'string' || !msg.types.trim()) return { ok: false, reason: 'missing types CSV' };
  return { ok: true };
}

function validateEnvelope(msg, origin, allowedOrigin, type) {
  if (!allowedOrigin) return { ok: false, reason: 'no allowed parent origin' };
  if (origin !== allowedOrigin) return { ok: false, reason: 'origin not allowed' };
  if (!msg || typeof msg !== 'object') return { ok: false, reason: 'malformed message' };
  if (msg.type !== type) return { ok: false, reason: `not a ${type} message` };
  // version is checked, not decorative: an unknown version renders an explicit
  // mismatch state rather than guessing at the payload shape.
  if (msg.version !== VERSION) {
    return { ok: false, mismatch: true, reason: `host speaks version ${msg.version}, this build speaks ${VERSION}` };
  }
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
//
// onTypes is optional: the driver type library, normally posted just before
// dat:init. postMessage preserves order from one source, so a host that sends
// them in order gets them in order.
export function onInit(cb, onTypes) {
  const target = parentOrigin();
  if (!target) { cb(null, 'This tool was opened without a recognised host.'); return () => {}; }
  const handler = (e) => {
    if (onTypes && validateTypes(e.data, e.origin, target).ok) { onTypes(e.data.types); return; }
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
