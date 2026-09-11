import { useMemo, useState } from 'react';
import { bannedNodes, eligibility as computeEligibility, needsSetup, zoneMode } from '../engine.js';
import { assignedRefs, isProvision, orphanClusters, zoneAccent, zoneStats } from '../state.js';
import Search from './Search.jsx';
import Tooltip from './Tooltip.jsx';

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
  const inUse = useMemo(
    () => model.inventory.filter((t) => model.drivers.some((d) => d.typeRef === t.typeRef)),
    [model.inventory, model.drivers],
  );
  const onboarding = useMemo(() => needsSetup({ inventory: inUse }), [inUse]);
  const banned = useMemo(() => bannedNodes(model), [model]);
  const [metric, setMetric] = useState('completion'); // completion% (default) | capacity%

  const zones = useMemo(() => {
    const assigned = assignedRefs(assignments);
    return model.zones.map((zone) => {
      const s = zoneStats(zone, model, assignments, addedDrivers, flags, state.deletedDrivers);
      const unassigned = model.links.filter((l) => l.zone === zone && !assigned.has(l.ref)).length;
      const mainTray = model.links.filter((l) => l.zone === zone && !assigned.has(l.ref) && !isProvision(l));
      const elig = computeEligibility(model, zone, assignments, addedDrivers);
      const orphans = orphanClusters(mainTray, elig, model.inventory).length;
      // a hub with no cables at all is a tender estimate, not a 0% assignment
      const mode = zoneMode(model, zone);
      const units = mode === 'estimate'
        ? (model.requirements || []).filter((r) => r.zone === zone).reduce((n, r) => n + r.qty, 0)
        : 0;
      return { zone, ...s, unassigned, orphans, mode, units };
    }).sort(SORTS[sort]);
  }, [model, assignments, addedDrivers, flags, sort, state.deletedDrivers]);

  return (
    <div className="container py-4" style={{ maxWidth: 860 }}>
      {/* Nothing on any of these hubs can be sized or checked until the driver
          types state something, so it is said where you land rather than two
          screens in on a page you would only open if you already knew. */}
      {(onboarding || banned.length > 0) && (
        <div className="dp-suggest sw-offer mb-3">
          <div>
            {onboarding ? (
              <>
                <b>This project’s driver types have no attributes filled in</b>
                <div className="text-secondary small">
                  Watts, current and forward voltage all live on ElementTypes. Until
                  they are there, every driver reads as undetermined and nothing is
                  checked. Most fill in from their datasheet in one press.
                </div>
              </>
            ) : (
              <>
                <b>
                  {banned.length} driver type{banned.length === 1 ? '' : 's'} use a colon in a node name
                </b>
                <div className="text-secondary small">
                  The colon is spoken for elsewhere in Parameters syntax and has to go.
                </div>
              </>
            )}
          </div>
          <button className="btn btn-sm btn-primary ms-auto"
            onClick={() => dispatch({ type: 'SET_VIEW', view: { page: 'types' } })}>
            {onboarding ? 'Fill them in' : 'Correct them'}
          </button>
        </div>
      )}

      <div className="d-flex align-items-center gap-3 mb-3 flex-wrap">
        <h4 className="mb-0">Pullzones</h4>
        <div className="btn-group btn-group-sm" role="group">
          <button className={`btn btn-outline-secondary ${metric === 'completion' ? 'active' : ''}`}
            onClick={() => setMetric('completion')}>Completion</button>
          <button className={`btn btn-outline-secondary ${metric === 'capacity' ? 'active' : ''}`}
            onClick={() => setMetric('capacity')}>Usage</button>
        </div>
        <div className="ms-auto d-flex align-items-center gap-2">
          <Search model={model} dispatch={dispatch} />
          <select className="form-select form-select-sm" style={{ width: 'auto' }}
            value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="problems">Sort: problems</option>
            <option value="completion">Sort: least complete</option>
            <option value="orphans">Sort: drivers needed</option>
            <option value="capacity">Sort: usage</option>
            <option value="unassigned">Sort: unassigned</option>
            <option value="name">Sort: name</option>
          </select>
        </div>
      </div>
      <div className="list-group shadow-sm" data-tour="zones">
        {zones.map((z) => {
          const accent = zoneAccent(z.zone, model.zones);
          if (z.mode === 'estimate') return (
            <button key={z.zone}
              className="list-group-item list-group-item-action d-flex align-items-center gap-3 py-3"
              onClick={() => dispatch({ type: 'SET_VIEW', view: { page: 'estimate', zone: z.zone } })}>
              <span className="zone-dot" style={{ background: accent }} />
              <span className="fw-semibold flex-shrink-0" style={{ width: 90 }}>{z.zone}</span>
              <span className="text-secondary small flex-grow-1">
                {+z.units.toFixed(1)} units · no cables yet
              </span>
              <Tooltip content="No links and no drivers — sized from its Positions (DJ 100053)">
                <span className="badge badge-tray flex-shrink-0">estimate</span>
              </Tooltip>
            </button>
          );
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
            {z.unassigned > 0 && (
              <Tooltip content="Cables not yet assigned to any driver node">
                <span className="badge badge-tray flex-shrink-0">{z.unassigned} tray</span>
              </Tooltip>
            )}
            {z.orphans > 0 && (
              <Tooltip content="Fingerprint clusters with no eligible node — drivers needed">
                <span className="badge badge-warn flex-shrink-0">{z.orphans} need</span>
              </Tooltip>
            )}
            {z.fails > 0 && (
              <Tooltip content="Actionable issues: overfill, or wrong CC/CV type/voltage/current">
                <span className="badge badge-fail flex-shrink-0">{z.fails}</span>
              </Tooltip>
            )}
            {z.warns > 0 && (
              <Tooltip content="Info / expected warnings (e.g. undeclared limits, within-tolerance current)">
                <span className="badge badge-info-muted flex-shrink-0">{z.warns}</span>
              </Tooltip>
            )}
            <span className="material-icons text-secondary">chevron_right</span>
          </button>
          );
        })}
      </div>
    </div>
  );
}
