import { useMemo, useState } from 'react';
import * as api from '../api.js';
import {
  assignedRefs, driverMatchesFilter, effectiveDrivers, filterOptions, isPending, isProvision,
  keyOf, linksByRef, linksForNode, orphanClusters, zoneAccent, zoneControlGroups, zoneStats,
} from '../state.js';
import AddDriverModal from './AddDriverModal.jsx';
import DriverBin from './DriverBin.jsx';
import LabelConfig from './LabelConfig.jsx';
import ReviewModal from './ReviewModal.jsx';
import Search from './Search.jsx';
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
  const { model, assignments, addedDrivers, flags, eligibility, focusNode } = state;
  const [showAdd, setShowAdd] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [showInfo, setShowInfo] = useState(false); // #5 expected/info warnings collapsed by default
  const [trayFilter, setTrayFilter] = useState('all'); // #9 drills tray AND driver grid
  const [distNote, setDistNote] = useState(null);

  const links = useMemo(() => linksByRef(model), [model]);
  const accent = zoneAccent(zone, model.zones);
  const zoneCables = model.links.filter((l) => l.zone === zone && !isProvision(l));
  const trayFilterOptions = useMemo(() => filterOptions(zoneCables), [zoneCables]);
  // evenly-spaced ControlGroup hues need the full set present in this zone
  const cgGroups = useMemo(() => zoneControlGroups(model, zone), [model, zone]);

  // #5 actionable = FAIL/MISMATCH; info = WARN (hidden from block styling unless toggled on)
  const shownFlags = showInfo ? flags : flags.filter((f) => f.level !== 'WARN');
  const flagIndex = useMemo(() => buildFlagIndex(shownFlags), [shownFlags]);
  const stats = zoneStats(zone, model, assignments, addedDrivers, flags);

  const zoneDrivers = effectiveDrivers(model, addedDrivers).filter((d) => d.zone === zone);
  // #9 the tray filter also hides drivers that can't take the filtered cables
  const filtered = zoneDrivers.filter((d) => driverMatchesFilter(d, trayFilter));
  const shownDrivers = problemsOnly
    ? filtered.filter((d) => (flagIndex.byDriver.get(d.ref) ?? [])
        .some((f) => f.level === 'FAIL' || f.level === 'MISMATCH'))
    : filtered;

  const assigned = assignedRefs(assignments);
  const allTray = model.links.filter((l) => l.zone === zone && !assigned.has(l.ref));
  const provisionLinks = allTray.filter(isProvision);          // #6
  let mainTray = allTray.filter((l) => !isProvision(l));

  // #3 fill-this-node: narrow the tray to what the focused node can accept
  const focusEligible = focusNode ? linksForNode(focusNode, eligibility) : null;
  const visibleTray = focusEligible ? mainTray.filter((l) => focusEligible.has(l.ref)) : mainTray;

  // #7 orphan clusters → recommended driver to add
  const orphans = useMemo(
    () => (eligibility ? orphanClusters(mainTray, eligibility, model.inventory) : []),
    [eligibility, mainTray, model.inventory],
  );

  const onNodeClick = (key) => {
    if (state.distributeGroup) { dispatch({ type: 'TOGGLE_DIST_NODE', key }); return; } // mark target
    if (state.selectedLinks.length) { dispatch({ type: 'MOVE_MANY', linkRefs: state.selectedLinks, toKey: key }); return; }
    dispatch({ type: 'FOCUS_NODE', key });
  };

  const confirmDistribute = async () => {
    const refs = mainTray.filter((l) => (l.controlGroup || '—') === state.distributeGroup).map((l) => l.ref);
    const { placements, unplaced } = await api.distribute(assignments, addedDrivers, refs, state.distributeNodes);
    dispatch({ type: 'DISTRIBUTE', placements });
    setDistNote(unplaced.length ? `${unplaced.length} cable${unplaced.length > 1 ? 's' : ''} didn't fit — still in the tray.` : null);
  };

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
          {stats.pct}% usage
        </span>
        {stats.fails > 0 && <span className="badge badge-fail">{stats.fails} issue{stats.fails > 1 ? 's' : ''}</span>}
        {stats.warns > 0 && <span className="badge badge-info-muted">{stats.warns} info</span>}
        <div className="ms-auto d-flex align-items-center gap-3">
          <Search model={model} dispatch={dispatch} />
          <LabelConfig fields={state.prefs.label} dispatch={dispatch} />
          <div className="form-check form-switch mb-0">
            <input className="form-check-input" type="checkbox" id="showInfo"
              checked={showInfo} onChange={(e) => setShowInfo(e.target.checked)} />
            <label className="form-check-label small" htmlFor="showInfo">Info warnings</label>
          </div>
          <div className="form-check form-switch mb-0">
            <input className="form-check-input" type="checkbox" id="problemsOnly"
              checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} />
            <label className="form-check-label small" htmlFor="problemsOnly">Problems only</label>
          </div>
        </div>
      </header>

      <div className="zone-toolbar">
        <button className="btn btn-sm btn-outline-primary" onClick={() => setShowAdd(true)}>
          <span className="material-icons small-icon align-middle">add</span> Driver
        </button>
        <button className="btn btn-sm btn-outline-secondary" disabled={!state.undo.length}
          onClick={() => dispatch({ type: 'UNDO' })} title="Undo (Ctrl+Z)">
          <span className="material-icons small-icon align-middle">undo</span> Undo
        </button>
        <button className="btn btn-sm btn-outline-secondary" disabled={!state.redo.length}
          onClick={() => dispatch({ type: 'REDO' })} title="Redo (Ctrl+Shift+Z)">
          <span className="material-icons small-icon align-middle">redo</span> Redo
        </button>
        <button className="btn btn-sm btn-primary" data-tour="review" onClick={() => setShowReview(true)}>
          Review{pendingCount > 0 && <span className="badge text-bg-light ms-1">{pendingCount}</span>}
        </button>
      </div>

      {distNote && (
        <div className="orphan-bar" style={{ background: '#eef6ff', borderColor: '#cfe2ff' }}>
          <span className="material-icons small-icon align-middle text-secondary">info</span>
          <span className="small">{distNote}</span>
          <button className="btn btn-sm btn-link p-0 ms-2" onClick={() => setDistNote(null)}>dismiss</button>
        </div>
      )}

      {orphans.length > 0 && (
        <div className="orphan-bar">
          <span className="material-icons small-icon align-middle text-warn">report_problem</span>
          {orphans.map((o) => (
            <span key={o.key} className="orphan-chip">
              {o.links.length} × {o.key} nowhere to go
              {o.type
                ? <button className="btn btn-sm btn-warning ms-2 py-0"
                    onClick={() => dispatch({ type: 'ADD_DRIVER', typeRef: o.type.typeRef, zone })}>
                    + {o.type.typeRef}
                  </button>
                : <span className="text-secondary ms-2">no matching driver type in inventory</span>}
            </span>
          ))}
        </div>
      )}

      <div className="zone-body">
        <Tray trayLinks={visibleTray} provisionLinks={provisionLinks} state={state} dispatch={dispatch}
          focusActive={!!focusNode} filter={trayFilter} setFilter={setTrayFilter} filterOpts={trayFilterOptions}
          onConfirmDistribute={confirmDistribute} groups={cgGroups} />

        <div className="driver-grid" data-tour="grid">
          {shownDrivers.map((d) => (
            <DriverBin key={d.ref} driver={d} state={state} dispatch={dispatch}
              links={links} accent={accent} flagIndex={flagIndex} onNodeClick={onNodeClick} groups={cgGroups} />
          ))}
          {!shownDrivers.length && (
            <p className="text-secondary p-4">
              {problemsOnly ? 'No drivers with problems in this zone.' : 'No drivers in this zone — add one.'}
            </p>
          )}
        </div>
      </div>

      {showAdd && <AddDriverModal model={model} zone={zone} dispatch={dispatch} onClose={() => setShowAdd(false)} />}
      {showReview && <ReviewModal state={state} dispatch={dispatch} onClose={() => setShowReview(false)} />}
    </div>
  );
}
