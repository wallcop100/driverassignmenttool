import { useState } from 'react';
import * as api from '../api.js';
import { isEmbedded } from '../embed.js';
import { listSessions } from '../persist.js';
import { diffRows, outRef, provisionalTypes } from '../state.js';

const embedded = isEmbedded();

export default function ReviewModal({ state, dispatch, onClose }) {
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [patchCopied, setPatchCopied] = useState(false);
  const [allCopied, setAllCopied] = useState(false);
  const rows = diffRows(state);
  const provisional = provisionalTypes(state);

  // Embedded, other hubs of this branch+set are sitting in storage with their
  // own models, so the workbook can be patched once for all of them.
  const sessions = embedded ? listSessions() : [];
  const otherHubs = sessions.length - 1;

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

  // copy/paste, not a download — the script is pasted straight into the
  // Office Scripts / ExcelScript code editor, no file to save or import.
  // (embedded, api.copyPatch hands it to the host instead; the clipboard is
  // not reliably ours inside an iframe)
  const doPatch = async () => {
    setError(null);
    try {
      const script = await api.generatePatch(state.assignments, state.addedDrivers, state.presets);
      await api.copyPatch(script);
      setPatchCopied(true);
      setTimeout(() => setPatchCopied(false), 2000);
    } catch (e) {
      setError(e.message || 'Could not copy to clipboard');
    }
  };

  const doPatchAll = async () => {
    setError(null);
    try {
      await api.copyPatch(await api.generatePatchAll(sessions));
      setAllCopied(true);
      setTimeout(() => setAllCopied(false), 2000);
    } catch (e) {
      setError(e.message || 'Could not build the combined patch');
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
            {provisional.length > 0 && (
              <div className="alert alert-warning py-2 small">
                <span className="material-icons small-icon align-middle">science</span>{' '}
                <b>Ratings supplied here, not read from DesignDB.</b> The patch marks each
                row <code>IsPropertiesTBC</code> — confirm before commit.
                <ul className="mb-0 mt-1">
                  {provisional.map((t) => (
                    <li key={t.typeRef}>
                      <b>{t.typeRef}</b>{t.invented ? ' — new type, not in the library' : ''}
                      {t.drivers > 0 && ` · ${t.drivers} driver${t.drivers > 1 ? 's' : ''}`}
                    </li>
                  ))}
                </ul>
              </div>
            )}
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
                        {outRef(r.key).replace('|', ' · ')}
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
            {/* Embedded, the patch is the only output — the CSV round-trip needs
                a file the host cannot ingest in this format. */}
            {embedded && otherHubs > 0 && (
              <button className="btn btn-outline-primary" onClick={doPatchAll}
                title="One ExcelScript patch covering every hub you have worked on in this set">
                <span className="material-icons small-icon align-middle">{allCopied ? 'check' : 'layers'}</span>
                {allCopied ? 'Sent!' : `Patch all hubs (${sessions.length})`}
              </button>
            )}
            <button className={`btn ${embedded ? 'btn-primary' : 'btn-outline-secondary'}`}
              onClick={doPatch} disabled={!rows.length && !provisional.length}
              title="Copy an ExcelScript patch for LinksMap.FromLinkEndContext* (changed rows only) — paste it into the Office Scripts code editor">
              <span className="material-icons small-icon align-middle">{patchCopied ? 'check' : 'content_copy'}</span>
              {patchCopied ? 'Copied!' : embedded ? 'Patch this hub' : 'Copy Patch Script'}
            </button>
            {!embedded && (
              <button className="btn btn-primary" onClick={doExport} disabled={done}>
                Confirm &amp; export CSV
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
