import { useMemo, useState } from 'react';
import { STOCK_TYPES } from '../engine.js';
import { effectiveDrivers, outRef } from '../state.js';
import PresetEditor, { draftFrom, draftFromStock, rating, toPreset } from './PresetEditor.jsx';

// The driver catalogue, off the assignment screen. The Add-driver modal answers
// "what do I put in this hub"; this page answers "what does this job own, and
// are its ratings right" — one row per type, every hub's drivers counted, and
// the editor that supplies what the library left blank.
export default function DriversPage({ state, dispatch }) {
  const { model, presets, addedDrivers } = state;
  const [draft, setDraft] = useState(null);
  const [q, setQ] = useState('');

  const drivers = useMemo(() => effectiveDrivers(model, addedDrivers), [model, addedDrivers]);
  const usage = useMemo(() => {
    const by = new Map();
    for (const d of drivers) {
      const cur = by.get(d.typeRef) ?? { count: 0, zones: new Set(), added: 0 };
      cur.count += 1;
      if (d.zone) cur.zones.add(d.zone);
      if (d.added) cur.added += 1;
      by.set(d.typeRef, cur);
    }
    return by;
  }, [drivers]);

  const needle = q.trim().toLowerCase();
  const rows = model.inventory.filter((t) => !needle
    || t.typeRef.toLowerCase().includes(needle)
    || (t.name ?? '').toLowerCase().includes(needle));

  const save = () => { dispatch({ type: 'SET_PRESET', preset: toPreset(draft) }); setDraft(null); };
  const remove = () => { dispatch({ type: 'DELETE_PRESET', typeRef: draft.typeRef }); setDraft(null); };

  const undeclared = model.inventory.filter((t) => t.powerType == null || t.maxPowerW == null).length;

  return (
    <div className="container-fluid py-3 drivers-page">
      <div className="d-flex align-items-center gap-3 mb-3 flex-wrap">
        <button className="btn btn-sm btn-outline-secondary d-flex align-items-center"
          onClick={() => dispatch({ type: 'SET_VIEW', view: { page: 'landing' } })}>
          <span className="material-icons small-icon">arrow_back</span> Zones
        </button>
        <h5 className="mb-0">Driver types</h5>
        <span className="text-secondary small">
          {model.inventory.length} in the catalogue · {drivers.length} driver{drivers.length === 1 ? '' : 's'} across the job
        </span>
        {undeclared > 0 && (
          <span className="badge badge-warn" title="These cannot be sized against until their ratings are supplied">
            {undeclared} undeclared
          </span>
        )}
        <input className="form-control form-control-sm ms-auto" style={{ maxWidth: 220 }}
          placeholder="Filter types…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {draft ? (
        <div className="card mb-3">
          <PresetEditor draft={draft} setDraft={setDraft} inventory={model.inventory}
            onSave={save} onCancel={() => setDraft(null)}
            onDelete={presets[draft.typeRef] ? remove : null} />
        </div>
      ) : (
        <div className="mb-3 d-flex gap-2 flex-wrap align-items-center">
          <span className="text-secondary small">Add a type the library hasn’t got:</span>
          {STOCK_TYPES.map((t) => (
            <button key={t.name} type="button" className="stock-chip"
              onClick={() => setDraft(draftFromStock(t))}>{t.name}</button>
          ))}
          <button type="button" className="stock-chip"
            onClick={() => setDraft({
              typeRef: '', name: '', powerType: 'CC', maxPowerW: '', currentA: '', outputVoltageV: '',
              channels: 2, nodeMaxLoadW: '', nodeMaxFvV: '', invented: true,
            })}>blank…</button>
        </div>
      )}

      <table className="table table-sm align-middle drivers-table">
        <thead>
          <tr>
            <th>Type</th><th>Power</th><th>Rating</th><th>Per node</th>
            <th className="text-end">CH</th><th className="text-end">Drivers</th><th>Used in</th><th />
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const u = usage.get(t.typeRef);
            const node = t.nodes[0] ?? {};
            const bad = t.powerType == null || t.maxPowerW == null;
            return (
              <tr key={t.typeRef} className={bad ? 'table-warning' : undefined}>
                <td>
                  <div className="fw-semibold">{t.name || t.typeRef}</div>
                  {t.name && <div className="type-sub">{t.typeRef}</div>}
                  {presets[t.typeRef] && (
                    <span className="badge text-bg-warning preset-badge">
                      {presets[t.typeRef].invented ? 'new type' : 'preset'}
                    </span>
                  )}
                </td>
                <td>
                  <span className={`type-power ${t.powerType ? `is-${t.powerType.toLowerCase()}` : 'is-unknown'}`}>
                    {t.powerType ?? '—'}
                  </span>
                </td>
                <td>
                  {t.maxPowerW != null ? <b>{t.maxPowerW}W</b> : <i className="text-secondary">no max power</i>}
                  {rating(t) && <> · <b>{rating(t)}</b></>}
                </td>
                <td className="text-secondary">
                  {[node.maxLoadW != null && `${node.maxLoadW}W`, node.maxFvV != null && `${node.maxFvV}fV`]
                    .filter(Boolean).join(' · ') || '—'}
                </td>
                <td className="text-end">{t.nodes.length}</td>
                <td className="text-end">
                  {u?.count ?? 0}
                  {u?.added > 0 && <span className="text-secondary"> (+{u.added} new)</span>}
                </td>
                <td className="text-secondary small">
                  {u ? [...u.zones].sort().join(', ') : <span className="text-secondary">unused</span>}
                </td>
                <td className="text-end">
                  <button className="btn btn-sm btn-link p-0" title={`Edit ratings for ${t.typeRef}`}
                    onClick={() => setDraft(draftFrom(presets[t.typeRef] ? { ...t, ...presets[t.typeRef], nodes: t.nodes } : t))}>
                    <span className="material-icons small-icon">edit</span>
                  </button>
                </td>
              </tr>
            );
          })}
          {!rows.length && (
            <tr><td colSpan={8} className="text-secondary p-3">No types match “{q}”.</td></tr>
          )}
        </tbody>
      </table>

      {addedDrivers.length > 0 && (
        <>
          <h6 className="mt-4">Added in this session</h6>
          <p className="text-secondary small">
            All of these export as the placeholder ref E5000X, to be resolved in DesignDB.
          </p>
          <ul className="list-unstyled small">
            {addedDrivers.map((d) => (
              <li key={d.ref}>
                <b>{outRef(d.ref)}</b> · {model.inventory.find((t) => t.typeRef === d.typeRef)?.name || d.typeRef} · {d.zone}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
