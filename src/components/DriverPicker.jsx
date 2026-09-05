import { useEffect, useMemo, useState } from 'react';
import * as api from '../api.js';
import { resolveSpec } from '../engine.js';
import { effectiveDrivers } from '../state.js';
import { faults, ratingsOf } from '../typeFaults.js';
import NewTypeDialog from './NewTypeDialog.jsx';

// Adding a driver to a hub. One question, so one list and one press per row —
// no sections, no editing, no datasheet catalogue. A type that needs correcting
// says so and sends you to the types page; fixing it here would put an audit in
// the middle of an assignment.

export default function DriverPicker({ state, dispatch, zone }) {
  const { model, addedDrivers, assignments, prefs } = state;
  const [q, setQ] = useState('');
  const [plan, setPlan] = useState(null);
  const [adding, setAdding] = useState(false);

  const drivers = useMemo(() => effectiveDrivers(model, addedDrivers), [model, addedDrivers]);
  const usage = useMemo(() => {
    const by = new Map();
    for (const d of drivers) by.set(d.typeRef, (by.get(d.typeRef) ?? 0) + 1);
    return by;
  }, [drivers]);

  // A hub with no drivers can be sized from its cables; one that already has
  // them carries decisions this tool cannot see.
  const canSuggest = !drivers.some((d) => d.zone === zone);
  useEffect(() => {
    if (!canSuggest) return undefined;
    let stale = false;
    api.plan(zone, assignments, addedDrivers, {
      restrictControlGroup: prefs.restrictControlGroup, margin: prefs.margin,
    }).then((p) => !stale && setPlan(p)).catch(console.error);
    return () => { stale = true; };
  }, [canSuggest, zone, assignments, addedDrivers, prefs.restrictControlGroup, prefs.margin, model]);

  const needle = q.trim().toLowerCase();
  const types = model.inventory
    .map((t) => ({ t, spec: resolveSpec(t.name || t.typeRef) }))
    .map((x) => ({ ...x, f: faults(x.t, x.spec) }))
    .filter(({ t }) => !needle || t.typeRef.toLowerCase().includes(needle)
      || (t.name ?? '').toLowerCase().includes(needle))
    // most-used first: the type this job reaches for is usually the one it
    // already reached for.
    .sort((a, b) => (usage.get(b.t.typeRef) ?? 0) - (usage.get(a.t.typeRef) ?? 0)
      || a.t.typeRef.localeCompare(b.t.typeRef));

  const add = (typeRef) => {
    dispatch({ type: 'ADD_DRIVER', typeRef, zone });
    dispatch({ type: 'SET_VIEW', view: { page: 'zone', zone } });
  };
  const zoneCables = model.links.filter((l) => l.zone === zone && l.powerType).length;

  return (
    <div className="container-fluid py-3 picker-page">
      <div className="dp-head">
        <button className="btn btn-sm btn-outline-secondary d-flex align-items-center"
          onClick={() => dispatch({ type: 'SET_VIEW', view: { page: 'zone', zone } })}>
          <span className="material-icons small-icon">arrow_back</span> {zone}
        </button>
        <h5 className="mb-0">Add a driver to {zone}</h5>
        <input className="form-control form-control-sm ms-auto" style={{ maxWidth: 240 }}
          placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {canSuggest && plan?.drivers.length > 0 && (
        <div className="dp-suggest">
          <div>
            <b>{zone} has {zoneCables} cables and no drivers yet</b>
            <div className="text-secondary small">
              {plan.proposals.map((p) => `${p.count} × ${p.typeRef}`).join(' · ')} would hold them
              {prefs.restrictControlGroup && ', one ControlGroup each'}
              {plan.unplaced.length > 0 && ` · ${plan.unplaced.length} wouldn’t fit`}
            </div>
          </div>
          <button className="btn btn-sm btn-primary ms-auto"
            onClick={() => {
              dispatch({ type: 'APPLY_PLAN', drivers: plan.drivers, placements: plan.placements });
              dispatch({ type: 'SET_VIEW', view: { page: 'zone', zone } });
            }}>
            Add these {plan.drivers.length} drivers
          </button>
        </div>
      )}

      <div className="pk-list">
        {types.map(({ t, f }) => (
          <button key={t.typeRef} className={`pk-row ${f.length ? 'is-off' : ''}`}
            onClick={() => add(t.typeRef)}>
            <span className="pk-ref">{t.typeRef}</span>
            <span className={`type-power ${t.powerType ? `is-${t.powerType.toLowerCase()}` : 'is-unknown'}`}>
              {t.powerType ?? '—'}
            </span>
            <span className="pk-spec">{ratingsOf(t)}</span>
            <span className="pk-name">{t.name || '—'}</span>
            {f.length > 0 && (
              <span className="pk-warn" title={`${f.map((x) => x[0]).join(' · ')} — correct it on the types page`}>
                <span className="material-icons">warning_amber</span>
              </span>
            )}
            <span className="pk-use">{usage.get(t.typeRef) ?? 0} in use</span>
            <span className="pk-add">add</span>
          </button>
        ))}
        {!types.length && (
          <div className="pk-empty text-secondary">
            {needle ? `Nothing matches “${q}”.` : 'No driver types in this design yet.'}
          </div>
        )}
      </div>

      <div className="pk-foot">
        <button className="btn btn-sm btn-outline-primary" onClick={() => setAdding(true)}>
          New type…
        </button>
        <button className="btn btn-sm btn-link ms-auto"
          onClick={() => dispatch({ type: 'SET_VIEW', view: { page: 'types', zone } })}>
          Manage types →
        </button>
      </div>

      {adding && (
        <NewTypeDialog zone={zone} inventory={model.inventory} dispatch={dispatch}
          onClose={() => setAdding(false)}
          onCreated={(typeRef, added) => added && dispatch({ type: 'SET_VIEW', view: { page: 'zone', zone } })} />
      )}
    </div>
  );
}
