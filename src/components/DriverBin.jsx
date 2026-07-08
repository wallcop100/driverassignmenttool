import { useState } from 'react';
import { cgColor, driverLoad, driverStatus, isPending, keyOf, severityOf } from '../state.js';
import Block from './Block.jsx';
import KebabMenu from './KebabMenu.jsx';
import Tooltip from './Tooltip.jsx';

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

function Slot({ driver, node, state, dispatch, links, flagIndex, onNodeClick, groups }) {
  const [hover, setHover] = useState(false);
  const key = keyOf(driver.ref, node.name);
  const entry = state.assignments[key] ?? { toEntityType: '', refs: [] };
  const nodeFlags = flagIndex.byNode.get(key) ?? [];
  const severity = severityOf(nodeFlags); // FAIL/MISMATCH/WARN both real problems (mA + CC/CV included)
  const fail = severity === 'FAIL';
  const mismatch = severity === 'MISMATCH';
  const suggested = state.suggestions?.has(key);
  const focused = state.focusNode === key;
  const marked = state.distributeNodes.includes(key); // distribution target (#2)
  const positionLocked = entry.refs.length > 0 && entry.toEntityType === 'Position';

  const placed = entry.refs.map((r) => links[r]).filter(Boolean);
  const nodeWatts = placed.reduce((s, l) => s + (l.loadW ?? 0), 0);
  const seriesFv = placed.reduce((s, l) => s + (l.fvV ?? 0), 0);

  const cgs = [...new Set(placed.map((l) => l.controlGroup).filter(Boolean))];
  const cg = cgs.length === 1 ? cgs[0] : null;

  const dragLink = state.draggingLink ? links[state.draggingLink] : null;
  const ghost = hover && dragLink;

  const drop = (linkRef) => {
    setHover(false);
    if (!linkRef || positionLocked) return;
    dispatch({ type: 'MOVE', linkRef, toKey: key });
  };

  return (
    <div data-node={key}
      className={['node-slot', fail && 'is-fail', !fail && mismatch && 'is-mismatch',
        suggested && 'is-suggested', focused && 'is-focused', marked && 'is-marked',
        positionLocked && 'is-locked', ghost && 'is-dragover'].filter(Boolean).join(' ')}
      onDragOver={(e) => { if (!positionLocked) { e.preventDefault(); setHover(true); } }}
      onDragLeave={() => setHover(false)}
      onDrop={(e) => { e.preventDefault(); drop(e.dataTransfer.getData('text/plain')); }}
      onClick={() => onNodeClick(key)}>
      <div className="slot-header">
        <span className="fw-semibold">{node.name || '—'}</span>
        {cgs.length > 1 ? (
          <Tooltip content={`Serves multiple ControlGroups: ${cgs.join(', ')}`}>
            <span className="cg-chip cg-split">{cgs.join(' / ')}</span>
          </Tooltip>
        ) : cg ? (
          <span className="cg-chip" style={{ background: cgColor(cg, groups).bg, color: cgColor(cg, groups).text }}>
            {cg}
          </span>
        ) : null}
        <span className="ms-auto d-flex align-items-center gap-1">
          {node.maxLoadW == null && node.maxFvV == null && (
            <span className="text-secondary metric-label">
              {driver.undetermined ? 'undetermined' : `${nodeWatts.toFixed(1)}W`}
            </span>
          )}
          <KebabMenu title="Node actions" items={[{
            label: 'Return all to tray', icon: 'undo', disabled: !entry.refs.length,
            onClick: () => dispatch({ type: 'MOVE_MANY', linkRefs: entry.refs, toKey: null }),
          }]} />
        </span>
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
          <Block key={r} link={links[r]} linkRef={r} dispatch={dispatch} groups={groups}
            flags={(flagIndex.byLink.get(r) ?? []).concat(nodeFlags.filter((f) => !f.link))}
            pending={isPending(key, state.assignments, state.model.baseline)}
            selected={state.selectedLinks.includes(r)} />
        ))}
        {!entry.refs.length && (
          <span className="slot-empty">{marked ? 'distribution target' : focused ? 'filling…' : 'drop here'}</span>
        )}
      </div>
    </div>
  );
}

export default function DriverBin({ driver, state, dispatch, links, accent, flagIndex, onNodeClick, groups }) {
  // ALL flags for this driver — must not filter out node/link-scoped ones, since
  // TypeMatch/CVVoltage/CurrentMatch (CC/CV + mA checks) always carry those.
  const driverFlags = flagIndex.byDriver.get(driver.ref) ?? [];
  const severity = severityOf(driverFlags);
  const fail = severity === 'FAIL';
  const mismatch = severity === 'MISMATCH';
  const warn = severity === 'WARN';
  const load = driverLoad(driver, state.assignments, links);
  const pct = driver.maxPowerW ? Math.round((100 * load) / driver.maxPowerW) : null;
  const width = driver.undetermined ? 260 : Math.max(230, Math.min(140 + driver.maxPowerW * 1.8, 560));

  // #1 dim-the-impossible: classify relative to the selected link
  const status = driverStatus(driver.ref, state.selectedLinks, state.eligibility);
  const driverRefs = driver.nodes.flatMap((n) => state.assignments[keyOf(driver.ref, n.name)]?.refs ?? []);

  return (
    <div data-driver={driver.ref}
      className={['driver-bin', `status-${status}`, driver.undetermined && 'is-undetermined',
      fail && 'is-fail', !fail && mismatch && 'is-mismatch'].filter(Boolean).join(' ')}
      style={{ width, '--zone-accent': accent }}>
      <div className="bin-header">
        <span className="fw-bold">{driver.ref}</span>
        {driver.added && <span className="badge text-bg-info">NEW</span>}
        <span className={`type-chip type-${driver.powerType ?? 'unknown'}`}>
          {driver.powerType ?? '?'}{driver.powerType === 'CC' && driver.currentA ? ` ${driver.currentA}A`
            : driver.powerType === 'CV' && driver.outputVoltageV ? ` ${driver.outputVoltageV}V` : ''}
        </span>
        <span className="text-secondary small text-truncate flex-grow-1">{driver.typeRef}</span>
        {status === 'impossible' && <span className="status-tag tag-impossible">✕ type</span>}
        {status === 'full' && <span className="status-tag tag-full">no room</span>}
        {severity && (
          <Tooltip content={driverFlags.map((f) => f.message)}>
            <span className={`material-icons small-icon ${fail ? 'text-fail' : mismatch ? 'text-mismatch' : 'text-warn'}`}>
              {fail ? 'error' : mismatch ? 'report' : 'warning'}
            </span>
          </Tooltip>
        )}
        <KebabMenu title="Driver actions" items={[{
          label: 'Return all to tray', icon: 'undo', disabled: !driverRefs.length,
          onClick: () => dispatch({ type: 'MOVE_MANY', linkRefs: driverRefs, toKey: null }),
        }]} />
      </div>
      <Tooltip content={driver.driverRestrictions || 'Driver Restrictions undeclared — capacity not enforced for this driver'}>
        <div className="bin-capacity">
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
      </Tooltip>
      {driver.nodes.map((node) => (
        <Slot key={node.name} driver={driver} node={node} state={state} dispatch={dispatch}
          links={links} flagIndex={flagIndex} onNodeClick={onNodeClick} groups={groups} />
      ))}
    </div>
  );
}
