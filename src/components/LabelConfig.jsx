import { useEffect, useRef, useState } from 'react';
import { LABEL_FIELDS } from '../state.js';

// Checkbox picker for which fields show on the cable block face (new feature).
export default function LabelConfig({ fields, dispatch }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const toggle = (key) => {
    const next = fields.includes(key) ? fields.filter((k) => k !== key) : [...fields, key];
    dispatch({ type: 'SET_PREFS', prefs: { label: next } });
  };

  return (
    <div className="label-config" ref={ref}>
      <button className="btn btn-sm btn-outline-secondary" onClick={() => setOpen((v) => !v)}>
        <span className="material-icons small-icon align-middle">label</span> Label
      </button>
      {open && (
        <div className="label-menu">
          <div className="label-menu-title">Cable label shows</div>
          {LABEL_FIELDS.map((f) => (
            <label key={f.key} className="label-menu-item">
              <input type="checkbox" checked={fields.includes(f.key)} onChange={() => toggle(f.key)} />
              {f.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
