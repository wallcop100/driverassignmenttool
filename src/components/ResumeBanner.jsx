// Offered on the import screen (standalone) and over the live zone page
// (embedded) — a flaky iframe should never leave the user staring at a blocking
// prompt, so the host's fresh data loads underneath and this just sits on top.
//
// Dismissal is the caller's business, not local state: while an offer is
// outstanding App suppresses autosave, so it has to know when it was answered.
export default function ResumeBanner({ saved, onResume, onDiscard, className = 'mb-0' }) {
  if (!saved) return null;

  const changeCount = Object.entries(saved.assignments || {}).filter(([k, v]) =>
    (v.refs || []).join() !== (saved.model?.baseline?.[k]?.refs || []).join()).length;

  return (
    <div className={`alert alert-primary d-flex align-items-center gap-2 py-2 ${className}`}>
      <span className="material-icons">history</span>
      <div className="flex-grow-1 small">
        Previous session found{changeCount > 0 ? ` · ${changeCount} change${changeCount > 1 ? 's' : ''}` : ''}
        {saved.savedAt ? ` · ${new Date(saved.savedAt).toLocaleString()}` : ''}
      </div>
      <button className="btn btn-sm btn-primary" onClick={onResume}>Resume</button>
      <button className="btn btn-sm btn-outline-secondary" onClick={onDiscard}>Start fresh</button>
    </div>
  );
}
