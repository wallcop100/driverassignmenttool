import { useState } from 'react';
import * as api from '../api.js';
import { isEmbedded } from '../embed.js';
import { listSessions } from '../persist.js';
import { PLACEHOLDER_REF } from '../engine.js';
import { linkDiffRows, outRef, provisionalTypes } from '../state.js';

const embedded = isEmbedded();

export default function ReviewModal({ state, dispatch, onClose }) {
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [patchCopied, setPatchCopied] = useState(false);
  const [allCopied, setAllCopied] = useState(false);
  const rows = linkDiffRows(state);
  const provisional = provisionalTypes(state);
  // where a cable sits, written the way the sheet writes it
  const at = (key) => (key ? outRef(key).replace('|', ' · ') : 'tray');

  // Drivers this session invented. They are appended to Elements under one
  // literal placeholder Ref, so every one of them needs a real Ref writing in
  // before the workbook is committed — which is a thing to say here, once, not
  // a flag to stamp on each row.
  const added = state.addedDrivers ?? [];

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
      const script = await api.generatePatch(state.assignments, state.addedDrivers, state.presets, state.context);
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
            <h5 className="modal-title">
              Review changes ({rows.length + provisional.length + added.length})
            </h5>
            <button className="btn-close" onClick={onClose} />
          </div>
          <div className="modal-body">
            {/* Two kinds of change, two sections: ElementTypes rows and LinksMap
                rows are separate sheets and separate parts of the patch. */}
            {provisional.length > 0 && (
              <>
                <h6 className="rv-sec">
                  Driver types edited
                  <span>{provisional.length} ElementTypes row{provisional.length === 1 ? '' : 's'}</span>
                </h6>
                <table className="table table-sm align-middle">
                  <tbody>
                    {provisional.map((t) => (
                      <tr key={t.typeRef}>
                        <td className="fw-semibold rv-ref">{t.typeRef}</td>
                        <td className="text-secondary">
                          {t.invented
                            ? 'new type — the patch adds the row'
                            : 'the patch overwrites the ratings on this row'}
                          {t.drivers > 0 && ` · used by ${t.drivers} driver${t.drivers > 1 ? 's' : ''} here`}
                        </td>
                        <td className="text-end">
                          <button className="btn btn-sm btn-link p-0"
                            title="Drop this edit and leave the DesignDB row as it is"
                            onClick={() => dispatch({ type: 'DELETE_PRESET', typeRef: t.typeRef })}>
                            <span className="material-icons small-icon">undo</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-secondary small rv-note">
                  The patch overwrites the rating columns and nothing else on the row:
                  <code> IsTBC</code> and <code> IsPropertiesTBC</code> are left as the
                  workbook has them. Edits apply to every hub in this set, not just
                  {' '}{state.context?.hubLabel ?? 'this one'}.
                </p>
              </>
            )}

            {added.length > 0 && (
              <>
                <h6 className="rv-sec">
                  Drivers added
                  <span>{added.length} Elements row{added.length === 1 ? '' : 's'}</span>
                </h6>
                <table className="table table-sm align-middle">
                  <tbody>
                    {added.map((d) => (
                      <tr key={d.ref}>
                        <td className="fw-semibold rv-ref">{outRef(d.ref)}</td>
                        <td className="rv-ref text-secondary">{d.typeRef}</td>
                        <td className="text-secondary">{d.zone}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="rv-todo">
                  <span className="material-icons">edit_note</span>
                  <div>
                    <b>Give each of these a Ref before committing.</b> They are appended
                    under <code>{PLACEHOLDER_REF}</code> — one literal placeholder, the same
                    on every row, because the tool cannot know what the workbook will
                    number them. <code>Elements.Ref</code> has to be unique, and the
                    cables above are pointed at {PLACEHOLDER_REF} too, so renaming a row
                    means repointing its cables with it.
                  </div>
                </div>
              </>
            )}

            {rows.length > 0 && (
              <>
                <h6 className="rv-sec">
                  Cables moved
                  <span>{rows.length} LinksMap row{rows.length === 1 ? '' : 's'}</span>
                </h6>
                <table className="table table-sm align-middle">
                  <thead>
                    <tr><th>Cable</th><th>Was on</th><th /><th>Now on</th><th /></tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.ref} className={r.isNew ? 'table-info' : undefined}>
                        <td className="fw-semibold rv-ref">{r.ref}</td>
                        <td className="text-secondary">{at(r.from)}</td>
                        <td><span className="material-icons small-icon text-secondary">arrow_forward</span></td>
                        <td>
                          {at(r.to)}
                          {r.isNew && <span className="badge text-bg-info ms-2">NEW</span>}
                        </td>
                        <td className="text-end">
                          <button className="btn btn-sm btn-link p-0"
                            title="Put this cable back where the imported data had it"
                            onClick={() => dispatch({ type: 'MOVE', linkRef: r.ref, toKey: r.from })}>
                            <span className="material-icons small-icon">undo</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {!rows.length && !provisional.length && !added.length && (
              <p className="text-secondary">No changes against the imported baseline.</p>
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
