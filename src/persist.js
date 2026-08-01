// Full-session autosave to localStorage (#3): model + assignments + prefs, so a
// reload can restore everything without re-uploading the CSVs.
const PREFIX = 'driverassignmenttool.session.v1';

// Standalone: one slot. Embedded: one slot per hub, per set, per branch —
// the host posts hub by hub into the same iframe, so a single constant key
// would have every hub overwrite the last.
//
//   driverassignmenttool.session.v1:<branchId>:<systemSetId>:<hubRef>
//
let key = PREFIX;
let scope = null; // { branchId, systemSetId } — set only when embedded

const parse = (k) => {
  const [, branchId, systemSetId, hubRef] = k.split(':');
  return { branchId, systemSetId: Number(systemSetId), hubRef };
};

const allKeys = () => {
  try {
    return Object.keys(localStorage).filter((k) => k.startsWith(`${PREFIX}:`));
  } catch { return []; }
};

// systemSetIds are sequential within a branch, so anything below the one the
// host just sent is superseded and can go. This is the only eviction that runs
// in normal operation — it keeps storage bounded without guessing.
function evictSupersededSets(branchId, systemSetId) {
  if (!Number.isFinite(systemSetId)) return; // non-numeric: can't order, don't delete
  for (const k of allKeys()) {
    const p = parse(k);
    if (p.branchId !== String(branchId)) continue;
    if (Number.isFinite(p.systemSetId) && p.systemSetId < systemSetId) {
      try { localStorage.removeItem(k); } catch { /* ignore */ }
    }
  }
}

export function setSessionKey(branchId, systemSetId, hubRef) {
  key = `${PREFIX}:${branchId ?? ''}:${systemSetId ?? ''}:${hubRef ?? ''}`;
  scope = { branchId: String(branchId ?? ''), systemSetId: Number(systemSetId) };
  evictSupersededSets(scope.branchId, scope.systemSetId);
}

// Every saved hub in the current branch+set, current one first. This is what
// makes "patch all hubs" possible: each slot holds its own full model, so the
// patch can be built from memory without revisiting each hub.
export function listSessions() {
  if (!scope) return [];
  const out = [];
  for (const k of allKeys()) {
    const p = parse(k);
    if (p.branchId !== scope.branchId) continue;
    if (p.systemSetId !== scope.systemSetId) continue;
    try {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const session = JSON.parse(raw);
      if (session?.model) out.push({ key: k, hubRef: p.hubRef, ...session });
    } catch { /* skip unreadable slot */ }
  }
  return out.sort((a, b) => (a.key === key ? -1 : b.key === key ? 1 : a.hubRef.localeCompare(b.hubRef)));
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
    //
    // ponytail: evict every other slot and retry once. Costs the other hubs'
    // saved work, which is why superseded-set eviction above runs first and
    // usually makes this unreachable. LRU by savedAt if that stops holding.
    for (const k of allKeys()) {
      if (k !== key) { try { localStorage.removeItem(k); } catch { /* ignore */ } }
    }
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
