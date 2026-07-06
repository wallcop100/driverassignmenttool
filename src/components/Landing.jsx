import { zoneAccent, zoneStats } from '../state.js';

export default function Landing({ state, dispatch }) {
  const { model, assignments, addedDrivers, flags } = state;
  return (
    <div className="container py-4" style={{ maxWidth: 720 }}>
      <h4 className="mb-3">Pullzones</h4>
      <div className="list-group shadow-sm">
        {model.zones.map((zone) => {
          const s = zoneStats(zone, model, assignments, addedDrivers, flags);
          return (
            <button key={zone}
              className="list-group-item list-group-item-action d-flex align-items-center gap-3 py-3"
              onClick={() => dispatch({ type: 'SET_VIEW', view: { page: 'zone', zone } })}>
              <span className="zone-dot" style={{ background: zoneAccent(zone) }} />
              <span className="fw-semibold flex-shrink-0" style={{ width: 90 }}>{zone}</span>
              <div className="progress flex-grow-1" style={{ height: 10 }}>
                <div className={`progress-bar ${s.pct > 100 ? 'bg-danger' : ''}`}
                  style={{ width: `${Math.min(s.pct, 100)}%`, background: s.pct > 100 ? undefined : zoneAccent(zone) }} />
              </div>
              <span className="text-secondary small flex-shrink-0" style={{ width: 110 }}>
                {s.pct}% · {s.load.toFixed(0)}/{s.capacity.toFixed(0)}W
              </span>
              {s.fails > 0 && <span className="badge badge-fail">{s.fails}</span>}
              {s.warns > 0 && <span className="badge badge-warn">{s.warns}</span>}
              <span className="material-icons text-secondary">chevron_right</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
