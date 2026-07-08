import { useState } from 'react';
import { cgColor, linkMatchesFilter } from '../state.js';
import Block from './Block.jsx';
import KebabMenu from './KebabMenu.jsx';

const SORTS = {
  'load-desc': (a, b) => (b.loadW ?? 0) - (a.loadW ?? 0),
  'load-asc': (a, b) => (a.loadW ?? 0) - (b.loadW ?? 0),
  name: (a, b) => a.ref.localeCompare(b.ref),
};

const g = (n) => (Number.isInteger(n) ? String(n) : String(+n.toFixed(6)));

function groupSummary(links) {
  const w = links.reduce((s, l) => s + (l.loadW ?? 0), 0);
  const types = new Set(links.map((l) => l.powerType).filter(Boolean));
  let t = '';
  if (types.size === 1) {
    const pt = [...types][0];
    if (pt === 'CC') {
      const cs = new Set(links.map((l) => l.currentA).filter(Boolean));
      t = cs.size === 1 ? `CC ${g([...cs][0] * 1000)}mA` : 'CC';
    } else {
      const vs = new Set(links.map((l) => l.voltageV).filter(Boolean));
      t = vs.size === 1 ? `CV ${g([...vs][0])}V` : 'CV';
    }
  }
  return { w, t };
}

export default function Tray({ trayLinks, provisionLinks, state, dispatch, focusActive, filter, setFilter, filterOpts, onConfirmDistribute, groups }) {
  const [sort, setSort] = useState('load-desc');
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [showProvision, setShowProvision] = useState(false);

  const shown = trayLinks.filter((l) => linkMatchesFilter(l, filter)).sort(SORTS[sort]);

  const unassignSelected = () => {
    const trayRefs = new Set(trayLinks.map((l) => l.ref));
    const toUnassign = state.selectedLinks.filter((r) => !trayRefs.has(r));
    if (toUnassign.length) dispatch({ type: 'MOVE_MANY', linkRefs: toUnassign, toKey: null });
  };

  const toggle = (key) => setCollapsed((c) => {
    const n = new Set(c);
    n.has(key) ? n.delete(key) : n.add(key);
    return n;
  });

  const byGroup = {};
  for (const l of shown) (byGroup[l.controlGroup || '—'] ??= []).push(l);
  const blocks = (links) => links.map((l) => (
    <Block key={l.ref} link={l} dispatch={dispatch} groups={groups} selected={state.selectedLinks.includes(l.ref)} />
  ));

  return (
    <div className="tray-rail" data-tour="tray"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); const r = e.dataTransfer.getData('text/plain'); if (r) dispatch({ type: 'MOVE_MANY', linkRefs: [r], toKey: null }); }}
      onClick={unassignSelected}>
      <div className="rail-head" onClick={(e) => e.stopPropagation()}>
        <div className="d-flex align-items-center gap-2 mb-2">
          <span className="fw-semibold small text-secondary d-flex align-items-center gap-1">
            <span className="material-icons small-icon">settings_ethernet</span>
            Links <span className="text-secondary">· {shown.length}</span>
          </span>
        </div>
        <div className="d-flex align-items-center gap-2">
          <select className="form-select form-select-sm" value={filter}
            onChange={(e) => setFilter(e.target.value)} title="also hides drivers that don't fit">
            <option value="all">CC + CV</option>
            <option value="CC">CC only</option>
            <option value="CV">CV only</option>
            {filterOpts.currents.length > 0 && (
              <optgroup label="CC current">
                {filterOpts.currents.map((a) => <option key={`A${a}`} value={`A:${a}`}>{g(a * 1000)} mA</option>)}
              </optgroup>
            )}
            {filterOpts.voltages.length > 0 && (
              <optgroup label="CV voltage">
                {filterOpts.voltages.map((v) => <option key={`V${v}`} value={`V:${v}`}>{g(v)} V</option>)}
              </optgroup>
            )}
          </select>
          <select className="form-select form-select-sm" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="load-desc">Load ↓</option>
            <option value="load-asc">Load ↑</option>
            <option value="name">Name</option>
          </select>
        </div>
      </div>

      {focusActive && (
        <div className="mode-banner" onClick={(e) => e.stopPropagation()}>
          <span className="material-icons small-icon align-middle">filter_alt</span>
          Filling node — only links that fit.
          <button className="btn btn-link btn-sm p-0 ms-1" onClick={() => dispatch({ type: 'FOCUS_NODE', key: null })}>exit</button>
        </div>
      )}
      {state.distributeGroup && (
        <div className="mode-banner" onClick={(e) => e.stopPropagation()}>
          <span className="material-icons small-icon align-middle">call_split</span>
          Distributing <b className="mx-1">{state.distributeGroup}</b> — click nodes to mark ({state.distributeNodes.length} marked).
          <button className="btn btn-primary btn-sm py-0 ms-2" disabled={!state.distributeNodes.length}
            onClick={onConfirmDistribute}>Confirm</button>
          <button className="btn btn-link btn-sm p-0 ms-1"
            onClick={() => dispatch({ type: 'START_DISTRIBUTE', group: state.distributeGroup })}>cancel</button>
        </div>
      )}

      {!shown.length && <div className="slot-empty p-2">no unassigned links{filter !== 'all' ? ' (filtered)' : ''}</div>}

      {Object.entries(byGroup).sort().map(([name, gl]) => {
        const isOpen = !collapsed.has(name);
        const { w, t } = groupSummary(gl);
        const color = cgColor(name === '—' ? null : name, groups);
        return (
          <div key={name} className={`tg ${state.distributeGroup === name ? 'is-selected' : ''}`}
            onClick={(e) => e.stopPropagation()}>
            <div className="tg-head" onClick={() => toggle(name)} style={{ borderLeftColor: color.border }}>
              <span className="material-icons tg-caret">{isOpen ? 'expand_more' : 'chevron_right'}</span>
              <span className="cg-chip" style={{ background: color.bg, color: color.text }}>{name}</span>
              <span className="text-secondary small">{gl.length}</span>
              <span className="tg-summary text-secondary small ms-auto">{w.toFixed(0)}W{t ? ` · ${t}` : ''}</span>
              <KebabMenu title="ControlGroup actions" items={[{
                label: 'Distribute across nodes', icon: 'call_split',
                onClick: () => dispatch({ type: 'START_DISTRIBUTE', group: name }),
              }]} />
            </div>
            {isOpen && <div className="tg-blocks">{blocks(gl)}</div>}
          </div>
        );
      })}

      {provisionLinks.length > 0 && (
        <div className="provision-lane" onClick={(e) => e.stopPropagation()}>
          <button className="provision-toggle" onClick={() => setShowProvision((v) => !v)}>
            <span className="material-icons small-icon">{showProvision ? 'expand_less' : 'expand_more'}</span>
            Undetermined ({provisionLinks.length})
          </button>
          {showProvision && <div className="tg-blocks">{blocks(provisionLinks)}</div>}
        </div>
      )}
    </div>
  );
}
