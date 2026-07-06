import { useState } from 'react';
import Block from './Block.jsx';

const SORTS = {
  'load-desc': (a, b) => (b.loadW ?? 0) - (a.loadW ?? 0),
  'load-asc': (a, b) => (a.loadW ?? 0) - (b.loadW ?? 0),
  name: (a, b) => a.ref.localeCompare(b.ref),
};

export default function Tray({ trayLinks, state, dispatch, children }) {
  const [sort, setSort] = useState('load-desc');
  const [filter, setFilter] = useState('all');

  const shown = trayLinks
    .filter((l) => filter === 'all' || (filter === 'other' ? !l.powerType : l.powerType === filter))
    .sort(SORTS[sort]);

  const unassignSelected = () => {
    if (state.selectedLink && !trayLinks.some((l) => l.ref === state.selectedLink)) {
      dispatch({ type: 'MOVE', linkRef: state.selectedLink, toKey: null });
    }
  };

  return (
    <div className="tray"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const ref = e.dataTransfer.getData('text/plain');
        if (ref) dispatch({ type: 'MOVE', linkRef: ref, toKey: null });
      }}
      onClick={unassignSelected}>
      <div className="tray-controls" onClick={(e) => e.stopPropagation()}>
        <span className="fw-semibold small text-secondary">TRAY · {shown.length}</span>
        <select className="form-select form-select-sm" style={{ width: 'auto' }}
          value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="load-desc">Load ↓</option>
          <option value="load-asc">Load ↑</option>
          <option value="name">Name</option>
        </select>
        <select className="form-select form-select-sm" style={{ width: 'auto' }}
          value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">All types</option>
          <option value="CC">CC</option>
          <option value="CV">CV</option>
          <option value="other">No type</option>
        </select>
        <div className="ms-auto d-flex gap-2">{children}</div>
      </div>
      <div className="tray-blocks">
        {shown.map((l) => (
          <Block key={l.ref} link={l} dispatch={dispatch}
            selected={state.selectedLink === l.ref} />
        ))}
        {!shown.length && <span className="slot-empty">no unassigned links{filter !== 'all' ? ' (filtered)' : ''} — drop a block here to unassign it</span>}
      </div>
    </div>
  );
}
