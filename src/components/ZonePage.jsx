import { useMemo, useState } from 'react';
import {
  assignedRefs, effectiveDrivers, isPending, keyOf, linksByRef, zoneAccent, zoneStats,
} from '../state.js';
import AddDriverModal from './AddDriverModal.jsx';
import DriverBin from './DriverBin.jsx';
import ReviewModal from './ReviewModal.jsx';
import Tray from './Tray.jsx';

function buildFlagIndex(flags) {
  const byDriver = new Map();
  const byNode = new Map();
  const byLink = new Map();
  const push = (map, key, f) => map.set(key, [...(map.get(key) ?? []), f]);
  for (const f of flags) {
    push(byDriver, f.driver, f);
    if (f.node != null) push(byNode, `${f.driver}|${f.node}`, f);
    if (f.link) push(byLink, f.link, f);
  }
  return { byDriver, byNode, byLink };
}

export default function ZonePage({ state, dispatch, zone }) {
  const { model, assignments, addedDrivers, flags } = state;
  const [showAdd, setShowAdd] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [problemsOnly, setProblemsOnly] = useState(false);

  const links = useMemo(() => linksByRef(model), [model]);
  const accent = zoneAccent(zone);
  const flagIndex = useMemo(() => buildFlagIndex(flags), [flags]);
  const stats = zoneStats(zone, model, assignments, addedDrivers, flags);

  const zoneDrivers = effectiveDrivers(model, addedDrivers).filter((d) => d.zone === zone);
  const shownDrivers = problemsOnly
    ? zoneDrivers.filter((d) => (flagIndex.byDriver.get(d.ref) ?? [])
        .some((f) => f.level === 'FAIL' || f.level === 'MISMATCH'))
    : zoneDrivers;

  const assigned = assignedRefs(assignments);
  const trayLinks = model.links.filter((l) => l.zone === zone && !assigned.has(l.ref));

  const pendingCount = zoneDrivers.reduce((n, d) => n + d.nodes.reduce((m, node) => {
    const key = keyOf(d.ref, node.name);
    return m + (d.added
      ? (assignments[key]?.refs.length ? 1 : 0)
      : (isPending(key, assignments, model.baseline) ? 1 : 0));
  }, 0), 0);

  return (
    <div className="zone-page" style={{ '--zone-accent': accent }}>
      <header className="zone-header">
        <button className="btn btn-sm btn-outline-secondary d-flex align-items-center"
          onClick={() => dispatch({ type: 'SET_VIEW', view: { page: 'landing' } })}>
          <span className="material-icons small-icon">arrow_back</span> Zones
        </button>
        <span className="zone-dot" style={{ background: accent }} />
        <h5 className="mb-0">{zone}</h5>
        <span className={`ms-2 fw-semibold ${stats.pct > 100 ? 'text-danger' : 'text-secondary'}`}>
          {stats.pct}% capacity
        </span>
        {stats.fails > 0 && <span className="badge badge-fail">{stats.fails} fail</span>}
        {stats.warns > 0 && <span className="badge badge-warn">{stats.warns} warn</span>}
        <div className="form-check form-switch ms-auto mb-0">
          <input className="form-check-input" type="checkbox" id="problemsOnly"
            checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} />
          <label className="form-check-label small" htmlFor="problemsOnly">Problems only</label>
        </div>
      </header>

      <Tray trayLinks={trayLinks} state={state} dispatch={dispatch}>
        <button className="btn btn-sm btn-outline-primary" onClick={() => setShowAdd(true)}>
          <span className="material-icons small-icon align-middle">add</span> Driver
        </button>
        <button className="btn btn-sm btn-outline-secondary" disabled={!state.undo.length}
          onClick={() => dispatch({ type: 'UNDO' })}>
          <span className="material-icons small-icon align-middle">undo</span> Undo
        </button>
        <button className="btn btn-sm btn-primary" onClick={() => setShowReview(true)}>
          Review{pendingCount > 0 && <span className="badge text-bg-light ms-1">{pendingCount}</span>}
        </button>
      </Tray>

      <div className="driver-grid">
        {shownDrivers.map((d) => (
          <DriverBin key={d.ref} driver={d} state={state} dispatch={dispatch}
            links={links} accent={accent} flagIndex={flagIndex} />
        ))}
        {!shownDrivers.length && (
          <p className="text-secondary p-4">
            {problemsOnly ? 'No drivers with problems in this zone.' : 'No drivers in this zone — add one.'}
          </p>
        )}
      </div>

      {showAdd && <AddDriverModal model={model} zone={zone} dispatch={dispatch} onClose={() => setShowAdd(false)} />}
      {showReview && <ReviewModal state={state} onClose={() => setShowReview(false)} />}
    </div>
  );
}
