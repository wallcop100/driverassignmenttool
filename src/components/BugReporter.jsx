import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { buildReport, loadMode, loadReports, newId, noteClick, remoteReport, reportsToMarkdown, saveMode, saveReports } from '../bugReports.js';
import { useCompanion } from '../companion.js';

// Floating bug pip for alpha testers. On: right-click anything to leave a note,
// saved with what was on screen. Shift + right-click keeps the browser menu.
// Served beside a companion (self-hosted), a note is SENT as well as kept, and the
// exact payload is shown before it goes; on Pages it is only ever saved here.
const download = (name, text) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

export default function BugReporter({ screen, getApp, getData }) {
  const companion = useCompanion();
  const canSend = !!companion?.report;
  const [on, setOn] = useState(loadMode);
  const [reports, setReports] = useState(loadReports);
  const [menu, setMenu] = useState(false);
  const [note, setNote] = useState(null);       // { x, y, target }
  const [text, setText] = useState('');
  const [where, setWhere] = useState(true);
  const [toast, setToast] = useState('');
  const screenRef = useRef(screen);
  screenRef.current = screen;

  useEffect(() => {
    const click = (e) => noteClick(e, screenRef.current);
    document.addEventListener('click', click, true);
    return () => document.removeEventListener('click', click, true);
  }, []);

  useEffect(() => {
    if (!on) return undefined;
    const ctx = (e) => {
      if (e.shiftKey || e.target.closest?.('[data-bug-reporter]')) return;
      e.preventDefault();
      setText('');
      setNote({ x: e.clientX, y: e.clientY, target: e.target, id: newId(new Set(reports.map((x) => x.id))) });
    };
    const key = (e) => { if (e.key === 'Escape') setNote(null); };
    document.addEventListener('contextmenu', ctx);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('contextmenu', ctx); document.removeEventListener('keydown', key); };
  }, [on, reports]);

  const toggle = () => { const v = !on; setOn(v); saveMode(v); setNote(null); };
  const commit = (list) => { setReports(list); saveReports(list); };
  const flash = (t) => { setToast(t); setTimeout(() => setToast(''), 2500); };
  const draft = (kind) => buildReport({ note: text.trim(), kind, target: note.target, withWhere: where,
    app: { screen: screenRef.current, ...(getApp ? getApp() : {}) }, id: note.id });
  const save = async (kind) => {
    if (!text.trim()) return;
    const r = draft(kind);
    const list = [...reports, r];
    commit(list);
    setNote(null);
    if (!canSend) { flash(`Saved ${r.id}`); return; }
    const ok = await companion.report(remoteReport(r, getData ? getData() : {}));
    // the local copy stays either way; a failed send is just a saved report
    if (ok) commit(list.map((x) => (x.id === r.id ? { ...x, sent: true } : x)));
    flash(ok ? `Sent ${r.id}` : `Saved ${r.id} - not sent`);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(reportsToMarkdown(reports)); setToast('Copied'); } catch { setToast('Copy blocked'); }
    setMenu(false);
    setTimeout(() => setToast(''), 2000);
  };

  const modal = document.querySelector('.modal.show');
  const w = 300;
  const box = note && (
    <div data-bug-reporter className="bug-note"
      style={{ left: Math.max(8, Math.min(note.x, window.innerWidth - w - 8)),
        top: Math.max(8, Math.min(note.y, window.innerHeight - 220)), width: w }}>
      <textarea autoFocus rows={4} className="form-control form-control-sm" placeholder="What's wrong?"
        value={text} onChange={(e) => setText(e.target.value)} />
      <label className="small d-block mt-1">
        <input type="checkbox" checked={where} onChange={(e) => setWhere(e.target.checked)} /> Record where
      </label>
      {canSend && (
        <details className="bug-preview small mt-1">
          <summary>What will be sent</summary>
          <pre>{JSON.stringify(remoteReport(draft(), getData ? getData() : {}), null, 1)}</pre>
        </details>
      )}
      <div className="d-flex gap-1 justify-content-end mt-1">
        <button className="btn btn-sm btn-outline-secondary" onClick={() => setNote(null)}>Cancel</button>
        <button className="btn btn-sm bug-feature" disabled={!text.trim()} onClick={() => save('feature')}>{canSend ? 'Send' : 'Save'} as Feature Request</button>
        <button className="btn btn-sm btn-danger" disabled={!text.trim()} onClick={() => save()}>{canSend ? 'Send' : 'Save'}</button>
      </div>
    </div>
  );

  return (
    <>
      <div data-bug-reporter className="bug-pip">
        <button className={`btn btn-sm ${on ? 'btn-danger' : 'btn-outline-secondary'}`} onClick={toggle}
          title={on ? 'Report mode on: right-click anything (Shift for the browser menu)' : 'Turn on report mode'}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M20 8h-2.8a6 6 0 0 0-1.6-1.8L17 4.8 15.6 3.4l-2 2a6 6 0 0 0-3.2 0l-2-2L7 4.8l1.4 1.4A6 6 0 0 0 6.8 8H4v2h2v2H4v2h2v2H4v2h2.8a6 6 0 0 0 10.4 0H20v-2h-2v-2h2v-2h-2v-2h2z" />
          </svg>
          {' '}{reports.length}
        </button>
        <button className="btn btn-sm btn-outline-secondary" onClick={() => setMenu(!menu)} aria-label="Bug report actions">▾</button>
        {menu && (
          <div className="bug-menu">
            <button disabled={!reports.length} onClick={copy}>Copy all as Markdown</button>
            <button disabled={!reports.length} onClick={() => { download(`bug-reports-${new Date().toISOString().slice(0, 10)}.md`, reportsToMarkdown(reports)); setMenu(false); }}>Save as .md</button>
            <button disabled={!reports.length} onClick={() => { if (window.confirm(`Delete all ${reports.length} reports?`)) commit([]); setMenu(false); }}>Delete all</button>
          </div>
        )}
        {toast && <span className="small ms-2">{toast}</span>}
      </div>
      {box && (modal ? createPortal(box, modal) : box)}
    </>
  );
}
