// Full-session autosave to localStorage (#3): model + assignments + prefs, so a
// reload can restore everything without re-uploading the CSVs.
const PREFIX = 'driverassignmenttool.session.v1';

// Standalone: one slot. Embedded: one slot per hub per point in time, because
// the host posts hub by hub into the same iframe — a single constant key means
// every hub overwrites the last and the resume offer is lying. systemSetId is
// the host's point-in-time token, so a newer set never offers stale work.
let key = PREFIX;
export function setSessionKey(systemSetId, hubRef) {
  key = `${PREFIX}:${systemSetId ?? ''}:${hubRef ?? ''}`;
}

// ponytail: on quota, evict every other session slot and retry once. Fine while
// a user touches a handful of hubs; switch to LRU by savedAt if that grows.
function evictOthers() {
  try {
    for (const k of Object.keys(localStorage)) {
      if (k !== key && k.startsWith(PREFIX)) localStorage.removeItem(k);
    }
  } catch { /* ignore */ }
}

export function saveSession(state) {
  if (!state.model) return;
  const payload = JSON.stringify({
    model: state.model,
    assignments: state.assignments,
    addedDrivers: state.addedDrivers,
    prefs: state.prefs,
    view: state.view,
    savedAt: Date.now(),
  });
  try {
    localStorage.setItem(key, payload);
  } catch {
    // quota exceeded, or storage disabled entirely — third-party iframe storage
    // is partitioned in Chrome and blocked outright under Safari ITP / Firefox
    // strict, so these guards degrade this to "no resume" rather than a throw.
    evictOthers();
    try { localStorage.setItem(key, payload); } catch { /* give up silently */ }
  }
}

export function loadSession() {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function clearSession() {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}
