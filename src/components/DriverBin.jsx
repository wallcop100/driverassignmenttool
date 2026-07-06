import { useState } from 'react';
import { cgColor, driverLoad, isPending, keyOf } from '../state.js';
import Block from './Block.jsx';

function Bar({ used, cap, unit, projected }) {
  const pct = cap ? Math.round((100 * used) / cap) : 0;
  const over = pct > 100;
  return (
    <div className="node-metric">
      <div className="slot-fill">
        <div className={over ? 'bg-fail' : 'bg-ok'} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className={`metric-label ${over ? 'text-danger fw-bold' : 'text-secondary'}`}>
        {projected != null ? <b>→ {projected.toFixed(1)}</b> : used.toFixed(1)}/{cap}{unit}
      </span>
    </div>
  );
}

function Slot({ driver, node, state, dispatch, links, flagIndex }) {
  const [hover, setHover] = useState(false);
  const key = keyOf(driver.ref, node.name);
  const entry = state.assignments[key] ?? { toEntityType: '', refs: [] };
  const nodeFlags = flagIndex.byNode.get(key) ?? [];
  const fail = nodeFlags.some((f) => f.level === 'FAIL');
  const suggested = state.suggestions?.has(key);
  const positionLocked = entry.refs.length > 0 && entry.toEntityType === 'Position';

  const placed = entry.refs.map((r) => links[r]).filter(Boolean);
  const nodeWatts = placed.reduce((s, l) => s + (l.loadW ?? 0), 0);
  const seriesFv = placed.reduce((s, l) => s + (l.fvV ?? 0), 0);

  // one ControlGroup per node — the meaningful label
  const groups = [...new Set(placed.map((l) => l.controlGroup).filter(Boolean))];
  const cg = groups.length === 1 ? groups[0] : null;

  const dragLink = state.draggingLink ? links[state.draggingLink] : null;
  const ghost = hover && dragLink;

  const drop = (linkRef) => {
    setHover(false);
    if (!linkRef || positionLocked) return;
    dispatch({ type: 'MOVE', linkRef, toKey: key });
  };

  return (
    <div
      className={['node-slot', fail && 'is-fail', suggested && 'is-suggested',
        positionLocked && 'is-locked', ghost && 'is-dragover'].filter(Boolean).join(' ')}
      onDragOver={(e) => { if (!positionLocked) { e.preventDefault(); setHover(true); } }}
      onDragLeave={() => setHover(false)}
      onDrop={(e) => { e.preventDefault(); drop(e.dataTransfer.getData('text/plain')); }}
      onClick={() => state.selectedLink && drop(state.selectedLink)}>
      <div className="slot-header">
        <span className="fw-semibold">{node.name || '—'}</span>
        {groups.length > 1 ? (
          <span className="cg-chip cg-split" title="node serves multiple ControlGroups">
            {groups.join(' / ')}
          </span>
        ) : cg ? (
          <span className="cg-chip" style={{ background: cgColor(cg).bg, color: cgColor(cg).text }}>
            {cg}
          </span>
        ) : null}
        {node.maxLoadW == null && node.maxFvV == null && (
          <span className="ms-auto text-secondary metric-label">
            {driver.undetermined ? 'unlimited' : `${nodeWatts.toFixed(1)}W`}
          </span>
        )}
      </div>

      {node.maxLoadW != null && (
        <Bar used={nodeWatts} cap={node.maxLoadW} unit="W"
          projected={ghost ? nodeWatts + (dragLink.loadW ?? 0) : null} />
      )}
      {node.maxFvV != null && (
        <Bar used={seriesFv} cap={node.maxFvV} unit="fV"
          projected={ghost ? seriesFv + (dragLink.fvV ?? 0) : null} />
      )}

      <div className="slot-blocks">
        {entry.refs.map((r) => (
          <Block key={r} link={links[r]} linkRef={r} dispatch={dispatch}
            flags={(flagIndex.byLink.get(r) ?? []).concat(nodeFlags.filter((f) => !f.link))}
            pending={isPending(key, state.assignments, state.model.baseline)}
            selected={state.selectedLink === r} />
        ))}
        {!entry.refs.length && <span className="slot-empty">drop here</span>}
      </div>
    </div>
  );
}

export default function DriverBin({ driver, state, dispatch, links, accent, flagIndex }) {
  const driverFlags = (flagIndex.byDriver.get(driver.ref) ?? []).filter((f) => !f.node && !f.link);
  const fail = driverFlags.some((f) => f.level === 'FAIL');
  const warn = driverFlags.some((f) => f.level === 'WARN');
  const load = driverLoad(driver, state.assignments, links);
  const pct = driver.maxPowerW ? Math.round((100 * load) / driver.maxPowerW) : null;
  const width = driver.undetermined ? 260 : Math.max(230, Math.min(140 + driver.maxPowerW * 1.8, 560));

  return (
    <div className={['driver-bin', driver.undetermined && 'is-undetermined', fail && 'is-fail']
      .filter(Boolean).join(' ')} style={{ width, '--zone-accent': accent }}>
      <div className="bin-header" title={driverFlags.map((f) => f.message).join('\n') || undefined}>
        <span className="fw-bold">{driver.ref}</span>
        {driver.added && <span className="badge text-bg-info">NEW</span>}
        <span className={`type-chip type-${driver.powerType ?? 'unknown'}`}>
          {driver.powerType ?? '?'}
        </span>
        <span className="text-secondary small text-truncate flex-grow-1">{driver.typeRef}</span>
        {(fail || warn) && (
          <span className={`material-icons small-icon ${fail ? 'text-fail' : 'text-warn'}`}>
            {fail ? 'error' : 'warning'}
          </span>
        )}
      </div>
      <div className="bin-capacity" title={driver.driverRestrictions || 'restrictions undeclared'}>
        {driver.maxPowerW != null ? (
          <>
            <span className="cap-title text-secondary">driver total</span>
            <div className="slot-fill flex-grow-1">
              <div className={pct > 100 ? 'bg-fail' : 'bg-ok'} style={{ width: `${Math.min(pct, 100)}%` }} />
            </div>
            <span className={`small ${pct > 100 ? 'text-danger fw-bold' : 'text-secondary'}`}>
              {load.toFixed(1)}/{driver.maxPowerW}W{pct > 100 && ' FAIL'}
            </span>
          </>
        ) : (
          <span className="small text-secondary">
            <span className="material-icons small-icon align-middle">help_outline</span> undetermined · {load.toFixed(1)}W
          </span>
        )}
      </div>
      {driver.nodes.map((node) => (
        <Slot key={node.name} driver={driver} node={node} state={state} dispatch={dispatch}
          links={links} flagIndex={flagIndex} />
      ))}
    </div>
  );
}
