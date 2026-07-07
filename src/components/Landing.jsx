import { useMemo, useState } from 'react';
import { eligibility as computeEligibility } from '../engine.js';
import { assignedRefs, isProvision, orphanClusters, zoneAccent, zoneStats } from '../state.js';
import Search from './Search.jsx';

const SORTS = {
  problems: (a, b) => b.fails - a.fails || b.orphans - a.orphans,
  completion: (a, b) => a.completionPct - b.completionPct,
  orphans: (a, b) => b.orphans - a.orphans,
  capacity: (a, b) => b.pct - a.pct,
  unassigned: (a, b) => b.unassigned - a.unassigned,
  name: (a, b) => a.zone.localeCompare(b.zone),
};

export default function Landing({ state, dispatch }) {
  const { model, assignments, addedDrivers, flags } = state;
  const [sort, setSort] = useState('problems');
  const [metric, setMetric] = useState('completion'); // completion% (default) | capacity%

  const zones = useMemo(() => {
    const assigned = assignedRefs(assignments);
    return model.zones.map((zone) => {
      const s = zoneStats(zone, model, assignments, addedDrivers, flags);
      const unassigned = model.links.filter((l) => l.zone === zone && !assigned.has(l.ref)).length;
      const mainTray = model.links.filter((l) => l.zone === zone && !assigned.has(l.ref) && !isProvision(l));
      const elig = computeEligibility(model, zone, assignments, addedDrivers);
      const orphans = orphanClusters(mainTray, elig, model.inventory).length;
      return { zone, ...s, unassigned, orphans };
    }).sort(SORTS[sort]);
  }, [model, assignments, addedDrivers, flags, sort]);

  return (
    <div className="container py-4" style={{ maxWidth: 860 }}>
      <div className="d-flex align-items-center gap-3 mb-3 flex-wrap">
        <h4 className="mb-0">Pullzones</h4>
        <div className="btn-group btn-group-sm" role="group">
          <button className={`btn btn-outline-secondary ${metric === 'completion' ? 'active' : ''}`}
            onClick={() => setMetric('completion')}>Completion</button>
          <button className={`btn btn-outline-secondary ${metric === 'capacity' ? 'active' : ''}`}
            onClick={() => setMetric('capacity')}>Capacity</button>
        </div>
        <div className="ms-auto d-flex align-items-center gap-2">
          <Search model={model} dispatch={dispatch} />
          <select className="form-select form-select-sm" style={{ width: 'auto' }}
            value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="problems">Sort: problems</option>
            <option value="completion">Sort: least complete</option>
            <option value="orphans">Sort: drivers needed</option>
            <option value="capacity">Sort: capacity</option>
            <option value="unassigned">Sort: unassigned</option>
            <option value="name">Sort: name</option>
          </select>
        </div>
      </div>
      <div className="list-group shadow-sm" data-tour="zones">
        {zones.map((z) => {
          const accent = zoneAccent(z.zone, model.zones);
          const val = metric === 'completion' ? z.completionPct : z.pct;
          const over = metric === 'capacity' && z.pct > 100;
          const label = metric === 'completion'
            ? `${z.completionPct}% · ${z.assignedCount}/${z.cableCount} cables`
            : `${z.pct}% · ${z.load.toFixed(0)}/${z.capacity.toFixed(0)}W`;
          return (
          <button key={z.zone}
            className="list-group-item list-group-item-action d-flex align-items-center gap-3 py-3"
            onClick={() => dispatch({ type: 'SET_VIEW', view: { page: 'zone', zone: z.zone } })}>
            <span className="zone-dot" style={{ background: accent }} />
            <span className="fw-semibold flex-shrink-0" style={{ width: 90 }}>{z.zone}</span>
            <div className="progress flex-grow-1" style={{ height: 10 }}>
              <div className={`progress-bar ${over ? 'bg-danger' : ''}`}
                style={{ width: `${Math.min(val, 100)}%`, background: over ? undefined : accent }} />
            </div>
            <span className="text-secondary small flex-shrink-0" style={{ width: 130 }}>
              {label}
            </span>
            {z.unassigned > 0 && <span className="badge badge-tray flex-shrink-0" title="unassigned links">{z.unassigned} tray</span>}
            {z.orphans > 0 && <span className="badge badge-warn flex-shrink-0" title="fingerprint clusters with no eligible node — drivers needed">{z.orphans} need</span>}
            {z.fails > 0 && <span className="badge badge-fail flex-shrink-0" title="actionable issues">{z.fails}</span>}
            {z.warns > 0 && <span className="badge badge-info-muted flex-shrink-0" title="info / expected warnings">{z.warns}</span>}
            <span className="material-icons text-secondary">chevron_right</span>
          </button>
          );
        })}
      </div>
    </div>
  );
}
