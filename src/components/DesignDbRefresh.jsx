import { useEffect, useRef, useState } from 'react';
import * as api from '../api.js';

// The DesignDB saved in Excel while the tool is open: offer to read it again,
// never do it unasked - a rebuild mid-check would move the numbers under you.
// Standalone only: embedded, the host sends the types and owns their freshness.
export default function DesignDbRefresh({ state, dispatch }) {
  const [change, setChange] = useState(null);
  const [msg, setMsg] = useState(null);
  const input = useRef(null);

  useEffect(() => {
    if (!state.model) return undefined;
    let stale = false;
    const check = () => api.designDbChange().then((c) => !stale && c && setChange(c));
    const id = setInterval(check, 5000);
    window.addEventListener('focus', check);
    return () => { stale = true; clearInterval(id); window.removeEventListener('focus', check); };
  }, [state.model]);

  if (!change) return null;
  const read = async (file) => {
    if (!file) return;
    setMsg('Reading…');
    try {
      const model = await api.attachDesignDb(file, state.presets, change.handle ?? null);
      if (model) dispatch({ type: 'SET_MODEL', model });
      setChange(null);
      setMsg(null);
    } catch (e) {
      setMsg(e.message);
    }
  };

  return (
    <div className="alert alert-info d-flex align-items-center gap-2 py-2 mb-0" role="status">
      <span className="material-icons">sync</span>
      <div className="flex-grow-1 small">The DesignDB has been saved since it was read. {msg}</div>
      {change.file
        ? <button className="btn btn-sm btn-primary" onClick={() => read(change.file)}>Refresh design data</button>
        : <>
          <button className="btn btn-sm btn-primary" onClick={() => input.current?.click()}>Choose it again</button>
          <input ref={input} type="file" accept=".xlsx,.xlsm" hidden
            onChange={(e) => { read(e.target.files[0]); e.target.value = ''; }} />
        </>}
      <button className="btn-close" aria-label="Not now" onClick={() => { api.skipDesignDbChange(change); setChange(null); }} />
    </div>
  );
}
