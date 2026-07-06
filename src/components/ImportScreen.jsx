import { useState } from 'react';
import * as api from '../api.js';

export default function ImportScreen({ dispatch }) {
  const [linksFile, setLinksFile] = useState(null);
  const [formFile, setFormFile] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      const model = await api.parse(formFile, linksFile);
      dispatch({ type: 'INIT', model });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container d-flex justify-content-center align-items-center min-vh-100">
      <div className="card shadow-sm import-card">
        <div className="card-body p-4">
          <h4 className="card-title mb-1">Driver Assignment Tool</h4>
          <p className="text-secondary mb-4">
            Upload a Links Assignment CSV and a Driver Assignment CSV to begin.
            A previously exported Driver Assignment CSV can be re-loaded here to resume.
          </p>
          <div className="mb-3">
            <label className="form-label fw-semibold">Links Assignment CSV</label>
            <input type="file" accept=".csv" className="form-control"
              onChange={(e) => setLinksFile(e.target.files[0] ?? null)} />
          </div>
          <div className="mb-4">
            <label className="form-label fw-semibold">Driver Assignment CSV</label>
            <input type="file" accept=".csv" className="form-control"
              onChange={(e) => setFormFile(e.target.files[0] ?? null)} />
          </div>
          {error && <div className="alert alert-danger py-2">{error}</div>}
          <button className="btn btn-primary w-100" disabled={!linksFile || !formFile || busy} onClick={load}>
            {busy ? 'Loading…' : 'Load project'}
          </button>
        </div>
      </div>
    </div>
  );
}
