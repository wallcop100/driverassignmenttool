import { useRef, useState } from 'react';
import * as api from '../api.js';

export default function ImportScreen({ dispatch, saved, onResume, onDiscard }) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const fileInput = useRef(null);

  const showResume = saved && !dismissed;
  const changeCount = saved
    ? Object.entries(saved.assignments || {}).filter(([k, v]) =>
        (v.refs || []).join() !== (saved.model?.baseline?.[k]?.refs || []).join()).length
    : 0;

  const loadFiles = async (files) => {
    const csvs = [...files].filter((f) => /\.csv$/i.test(f.name));
    if (!csvs.length) { setError('Drop CSV files (the two DataJoin exports).'); return; }
    setBusy(true);
    setError(null);
    try {
      const model = await api.parseAuto(csvs);
      dispatch({ type: 'INIT', model });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const useDemo = () => {
    setBusy(true);
    setError(null);
    try {
      dispatch({ type: 'INIT', model: api.loadDemo(), demo: true });
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="container d-flex justify-content-center align-items-center min-vh-100">
      <div className="card shadow-sm import-card">
        <div className="card-body p-4">
          <h4 className="card-title mb-1">Driver Assignment Tool</h4>
          <p className="text-secondary mb-4">
            Drop your Links Assignment and Driver Assignment CSVs below — both at once, in any order.
            A previously exported Driver Assignment CSV can be re-loaded to resume.
          </p>

          {showResume && (
            <div className="alert alert-primary d-flex align-items-center gap-2 py-2">
              <span className="material-icons">history</span>
              <div className="flex-grow-1 small">
                Previous session found{changeCount > 0 ? ` · ${changeCount} change${changeCount > 1 ? 's' : ''}` : ''}
                {saved.savedAt ? ` · ${new Date(saved.savedAt).toLocaleString()}` : ''}
              </div>
              <button className="btn btn-sm btn-primary" onClick={onResume}>Resume</button>
              <button className="btn btn-sm btn-outline-secondary"
                onClick={() => { onDiscard(); setDismissed(true); }}>Start fresh</button>
            </div>
          )}

          <div
            className={`dropzone ${dragOver ? 'is-over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); loadFiles(e.dataTransfer.files); }}
            onClick={() => fileInput.current?.click()}>
            <span className="material-icons dropzone-icon">{busy ? 'hourglass_top' : 'upload_file'}</span>
            <div className="fw-semibold">{busy ? 'Loading…' : 'Drop both CSVs here'}</div>
            <div className="text-secondary small">or click to browse — files are auto-detected</div>
            <input ref={fileInput} type="file" accept=".csv" multiple hidden
              onChange={(e) => loadFiles(e.target.files)} />
          </div>

          {error && <div className="alert alert-danger py-2 mt-3 mb-0">{error}</div>}
        </div>
        {/* sneaky demo entry */}
        <button className="demo-link" onClick={useDemo} title="Load bundled sample data">·</button>
      </div>
    </div>
  );
}
