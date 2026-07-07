import { useMemo, useRef, useState } from 'react';

// Global locate search (#6): find any link or driver ref → jump to its zone.
export default function Search({ model, dispatch }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const box = useRef(null);

  const index = useMemo(() => [
    ...model.links.map((l) => ({ ref: l.ref, zone: l.zone, kind: 'link', label: `${l.ref} · ${l.zone}` })),
    ...model.drivers.map((d) => ({ ref: d.ref, zone: d.zone, kind: 'driver', label: `${d.ref} · ${d.zone} · ${d.typeRef}` })),
  ], [model]);

  const matches = q.trim()
    ? index.filter((e) => e.ref.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8)
    : [];

  const go = (m) => {
    setQ('');
    setOpen(false);
    dispatch({ type: 'SET_VIEW', view: { page: 'zone', zone: m.zone } });
    if (m.kind === 'link') {
      // select after the zone view mounts so eligibility/highlight pick it up
      setTimeout(() => dispatch({ type: 'SELECT_LINKS', linkRef: m.ref, additive: false }), 0);
    }
  };

  return (
    <div className="global-search" ref={box}>
      <span className="material-icons small-icon search-icon">search</span>
      <input className="form-control form-control-sm" placeholder="Find ref…"
        value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => { if (e.key === 'Enter' && matches[0]) go(matches[0]); if (e.key === 'Escape') setOpen(false); }} />
      {open && matches.length > 0 && (
        <div className="search-results">
          {matches.map((m) => (
            <button key={`${m.kind}-${m.ref}`} className="search-item" onClick={() => go(m)}>
              <span className={`search-kind kind-${m.kind}`}>{m.kind}</span>
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
