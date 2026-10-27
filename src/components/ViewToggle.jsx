import { zoneViews } from '../engine.js';

// Cables | Assessment - the two views of one hub. Both are always offered,
// whatever the hub holds: comparing them is how a hub whose drivers disagree
// with its Positions gets noticed. A view with nothing to show stays clickable
// and says so on the page, rather than hiding and leaving the user to wonder.
export default function ViewToggle({ model, zone, current, dispatch }) {
  const has = zoneViews(model, zone);
  const go = (page) => page !== current && dispatch({ type: 'SET_VIEW', view: { page, zone } });
  const btn = (page, label, icon, there, empty) => (
    <button type="button"
      className={`btn btn-outline-secondary d-flex align-items-center gap-1 ${current === page ? 'active' : ''} ${there ? '' : 'text-muted'}`}
      title={there ? undefined : empty}
      aria-pressed={current === page}
      onClick={() => go(page)}>
      <span className="material-icons small-icon">{icon}</span>{label}
    </button>
  );
  return (
    <div className="btn-group btn-group-sm" role="group" aria-label="Hub view">
      {btn('zone', 'Cables', 'cable', has.cables, 'No cables or drivers in this hub yet')}
      {btn('estimate', 'Assessment', 'calculate', has.assessment,
        'No assessment rows for this hub - the host sent none')}
    </div>
  );
}
