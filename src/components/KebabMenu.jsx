import { useEffect, useRef, useState } from 'react';

// Reusable three-dots menu. items: [{ label, icon?, onClick, danger?, disabled? }]
export default function KebabMenu({ items, title = 'More' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="kebab" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button className="kebab-btn" title={title} onClick={() => setOpen((o) => !o)}>
        <span className="material-icons small-icon">more_vert</span>
      </button>
      {open && (
        <div className="kebab-menu">
          {items.map((it, i) => (
            <button key={i} className={`kebab-item ${it.danger ? 'danger' : ''}`} disabled={it.disabled}
              onClick={() => { setOpen(false); it.onClick(); }}>
              {it.icon && <span className="material-icons small-icon">{it.icon}</span>}{it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
