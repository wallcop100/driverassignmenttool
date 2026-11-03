import { useRef, useState } from 'react';
import * as api from '../api.js';
import { detectKind } from '../engine.js';
import { isWorkbook } from '../designdb.js';
import ResumeBanner from './ResumeBanner.jsx';

const FILES = [
  ['designdb', 'DesignDB (.xlsx)'],
  ['assessment', 'Secondary Power Assessment CSV'],
  ['links', 'Links Assignment CSV'],
  ['form', 'Driver Assignment CSV'],
];

// A function appears once the dropped files support it. `uses` is what it is
// opened with, so with everything dropped each one still opens as itself.
// A type library CSV (only the embedded host has one) counts as a DesignDB.
const FUNCTIONS = [
  { key: 'estimate', label: 'Secondary Power Assessment', icon: 'calculate',
    ready: (k) => k.has('assessment') && k.has('designdb'), uses: ['assessment', 'designdb'] },
  { key: 'size', label: 'Hub Spacing', icon: 'straighten',
    ready: (k) => k.has('links') && k.has('designdb'), uses: ['links', 'designdb', 'assessment'] },
  { key: 'assign', label: 'Driver Assignment', icon: 'cable',
    ready: (k) => k.has('links') && k.has('form'), uses: ['links', 'form', 'designdb', 'assessment'] },
];

const kindOf = async (f) => {
  if (isWorkbook(f)) return 'designdb';
  const k = detectKind(await f.text());
  return k === 'types' ? 'designdb' : k;
};

export default function ImportScreen({ dispatch, saved, onResume, onDiscard }) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  // Kept across drops; a later file of the same kind replaces the earlier one.
  const [staged, setStaged] = useState([]);
  const fileInput = useRef(null);

  // handles: per file, a promise of its FileSystemFileHandle (dropped in Chromium) or null
  const addFiles = async (list, handles = []) => {
    const picked = [...list].map((file, i) => ({ file, handle: handles[i] }))
      .filter(({ file }) => /\.(csv|xlsx|xlsm)$/i.test(file.name));
    if (!picked.length) { setError('Drop CSV exports or a DesignDB (.xlsx).'); return; }
    setError(null);
    const added = await Promise.all(picked.map(async ({ file, handle }) => ({
      file, kind: await kindOf(file), handle: await handle?.catch(() => null) ?? null,
    })));
    const unknown = added.filter((x) => !x.kind).map((x) => x.file.name);
    const known = added.filter((x) => x.kind);
    setStaged((prev) => [...prev.filter((s) => !known.some((a) => a.kind === s.kind)), ...known]);
    if (unknown.length) setError(`Not recognised: ${unknown.join(', ')}.`);
  };

  const open = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      const used = staged.filter((x) => fn.uses.includes(x.kind));
      const model = await api.parseAuto(used.map((x) => x.file));
      const book = used.find((x) => isWorkbook(x.file));
      if (book) api.watchDesignDb(book.file, book.handle);
      dispatch({ type: 'INIT', model });
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  };

  const useDemo = () => {
    setBusy(true);
    setError(null);
    // the demo CSVs are fetched on demand, so this is async now
    api.loadDemo()
      .then((model) => dispatch({ type: 'INIT', model, demo: true }))
      .catch((e) => { setError(e.message); setBusy(false); });
  };

  const have = new Set(staged.map((x) => x.kind));
  const ready = FUNCTIONS.filter((f) => f.ready(have));

  return (
    <div className="container d-flex justify-content-center align-items-center min-vh-100">
      <div className="card shadow-sm import-card">
        <div className="card-body p-4">
          <h4 className="card-title mb-3">Driver Assignment Tool</h4>

          <ResumeBanner saved={saved} onResume={onResume} onDiscard={onDiscard} className="mb-3" />

          <div
            className={`dropzone ${dragOver ? 'is-over' : ''}`}
            role="button" tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInput.current?.click(); }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault(); setDragOver(false);
              // asked for during the event: the items are gone once it returns
              const handles = [...e.dataTransfer.items].filter((it) => it.kind === 'file')
                .map((it) => it.getAsFileSystemHandle?.() ?? null);
              addFiles(e.dataTransfer.files, handles);
            }}
            onClick={() => fileInput.current?.click()}>
            <span className="material-icons dropzone-icon">upload_file</span>
            <div className="fw-semibold">Drop files here</div>
            <input ref={fileInput} type="file" accept=".csv,.xlsx,.xlsm" multiple hidden
              onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
          </div>

          <ul className="list-unstyled import-files mt-3 mb-0">
            {FILES.map(([kind, label]) => {
              const f = staged.find((x) => x.kind === kind);
              return (
                <li key={kind} className={f ? 'is-met' : ''} title={f?.file.name}>
                  <span className="material-icons" aria-hidden="true">{f ? 'check_box' : 'check_box_outline_blank'}</span>
                  {label}
                </li>
              );
            })}
          </ul>

          {ready.length > 0 && (
            <div className="d-grid gap-2 mt-3">
              {ready.map((fn) => (
                <button key={fn.key} className="btn btn-primary d-flex align-items-center justify-content-center gap-2"
                  disabled={busy} onClick={() => open(fn)}>
                  <span className="material-icons" aria-hidden="true">{fn.icon}</span>{fn.label}
                </button>
              ))}
            </div>
          )}

          {staged.length > 0 && (
            <button className="btn btn-link btn-sm p-0 mt-2" onClick={() => { setStaged([]); setError(null); }}>Clear</button>
          )}

          {error && <div className="alert alert-danger py-2 mt-3 mb-0">{error}</div>}
        </div>
        {/* sneaky demo entry */}
        <button className="demo-link" onClick={useDemo} title="Load bundled sample data">·</button>
      </div>
    </div>
  );
}
