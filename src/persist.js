// Full-session autosave to localStorage (#3): model + assignments + prefs, so a
// reload can restore everything without re-uploading the CSVs.
const KEY = 'driverassignmenttool.session.v1';

export function saveSession(state) {
  if (!state.model) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({
      model: state.model,
      assignments: state.assignments,
      addedDrivers: state.addedDrivers,
      prefs: state.prefs,
      view: state.view,
      savedAt: Date.now(),
    }));
  } catch { /* quota exceeded or storage disabled — silently skip */ }
}

export function loadSession() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function clearSession() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
