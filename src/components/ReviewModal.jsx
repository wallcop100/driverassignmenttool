import { useState } from 'react';
import * as api from '../api.js';

function diffRows(state) {
  const { assignments, addedDrivers, model } = state;
  const added = new Set(addedDrivers.map((d) => d.ref));
  const rows = [];
  const keys = new Set([...Object.keys(model.baseline), ...Object.keys(assignments)]);
  for (const key of [...keys].sort()) {
    const oldRefs = model.baseline[key]?.refs ?? [];
    const newRefs = assignments[key]?.refs ?? [];
    const isNew = added.has(key.split('|')[0]);
    if (isNew || oldRefs.join() !== newRefs.join()) {
      rows.push({ key, oldRefs, newRefs, isNew });
    }
  }
  return rows;
}

export default function ReviewModal({ state, dispatch, onClose }) {
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const rows = diffRows(state);

  const doExport = async () => {
    setError(null);
    try {
      const csv = await api.exportCsv(state.assignments, state.addedDrivers);
      const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '');
      await api.saveCsv(csv, `DriverAssignmentForm-${stamp}.csv`);
      setDone(true);
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="modal d-block modal-backdrop-custom" onClick={onClose}>
      <div className="modal-dialog modal-lg modal-dialog-scrollable" onClick={(e) => e.stopPropagation()}>
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Review changes ({rows.length})</h5>
            <button className="btn-close" onClick={onClose} />
          </div>
          <div className="modal-body">
            {!rows.length && <p className="text-secondary">No changes against the imported baseline.</p>}
            {rows.length > 0 && (
              <table className="table table-sm align-middle">
                <thead>
                  <tr><th>Driver · Node</th><th>Was</th><th /><th>Now</th><th /></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} className={r.isNew ? 'table-info' : undefined}>
                      <td className="fw-semibold">
                        {r.key.replace('|', ' · ')}
                        {r.isNew && <span className="badge text-bg-info ms-2">NEW</span>}
                      </td>
                      <td className="text-secondary">{r.oldRefs.join(', ') || '—'}</td>
                      <td><span className="material-icons small-icon text-secondary">arrow_forward</span></td>
                      <td>{r.newRefs.join(', ') || '—'}</td>
                      <td>
                        <button className="btn btn-sm btn-link p-0" title="Revert this row to the imported baseline"
                          onClick={() => dispatch({ type: 'REVERT_KEY', key: r.key })}>
                          <span className="material-icons small-icon">undo</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {error && <div className="alert alert-danger py-2">{error}</div>}
            {done && <div className="alert alert-success py-2">Exported. The file can be re-imported later to resume.</div>}
          </div>
          <div className="modal-footer">
            <button className="btn btn-outline-secondary" onClick={onClose}>Close</button>
            <button className="btn btn-primary" onClick={doExport} disabled={done}>
              Confirm &amp; export CSV
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
