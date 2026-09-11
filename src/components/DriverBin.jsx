import { useState } from 'react';
import { cgColor, driverLoad, driverStatus, isPending, keyOf, outRef, severityOf } from '../state.js';
import Block from './Block.jsx';
import FlagDialog from './FlagDialog.jsx';
import KebabMenu from './KebabMenu.jsx';
import Tooltip from './Tooltip.jsx';

function Bar({ used, cap, unit, projected, title }) {
  const pct = cap ? Math.round((100 * used) / cap) : 0;
  const over = pct > 100;
  return (
    <div className="node-metric" title={title}>
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

      {/* Watts, measured against whichever cap actually binds this output: its
          own NodeMaxPower(W) if the type states one, otherwise the driver total,
          which is the real limit and is shared across the outputs. Most types
          state only a forward voltage, so without this a node showed an fV bar
          and nothing at all for watts. */}
      {(node.maxLoadW ?? driver.maxPowerW) != null && (
        <Bar used={nodeWatts} cap={node.maxLoadW ?? driver.maxPowerW} unit="W"
          title={node.maxLoadW != null
            ? `NodeMaxPower(W) for ${node.name}`
            : `Watts on the driver total, shared across all ${driver.nodes.length} outputs`}
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
  const [showFlags, setShowFlags] = useState(false);
  const [showUndet, setShowUndet] = useState(false);
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
        <span className="fw-bold">{outRef(driver.ref)}</span>
        {/* the ref identifies it, the name is what people call it */}
        {(driver.name || driver.typeName) && (
          <span className="bin-name" title={driver.typeName || ''}>{driver.name || driver.typeName}</span>
        )}
        {/* added here, so not in the DesignDB yet — the same dashed-and-dotted
            language a moved cable and a corrected type use */}
        {driver.added && <span className="type-added">added</span>}
        <span className={`type-chip type-${driver.powerType ?? 'unknown'}`}>
          {driver.powerType ?? '?'}{driver.powerType === 'CC' && driver.currentA ? ` ${driver.currentA}A`
            : driver.powerType === 'CV' && driver.outputVoltageV ? ` ${driver.outputVoltageV}V` : ''}
        </span>
        {/* the same mark a moved cable carries: a dot means you changed this and
            it is not in the DesignDB yet */}
        {state.presets?.[driver.typeRef] && (
          <Tooltip content={`You have edited ${driver.typeRef}. The change applies to every hub in this set and is patched with the rest.`}>
            <span className="type-edited">edited</span>
          </Tooltip>
        )}
        <span className="text-secondary small text-truncate flex-grow-1">{driver.typeRef}</span>
        {status === 'impossible' && <span className="status-tag tag-impossible">✕ type</span>}
        {status === 'full' && <span className="status-tag tag-full">no room</span>}
        {severity && (
          <button type="button"
            className={`bin-flag ${fail ? 'is-fail' : mismatch ? 'is-mismatch' : 'is-warn'}`}
            onClick={() => setShowFlags(true)}
            title="What failed, in full">
            <span className="material-icons">{fail ? 'error' : mismatch ? 'report' : 'warning'}</span>
            {driverFlags.length}
          </button>
        )}
        <KebabMenu title="Driver actions" items={[
          {
            label: 'Return all to tray', icon: 'undo', disabled: !driverRefs.length,
            onClick: () => dispatch({ type: 'MOVE_MANY', linkRefs: driverRefs, toKey: null }),
          },
          {
            // Added here: it never reached the workbook, so it just goes.
            // Really in the design: the row is marked IsDeleted and patched.
            label: driver.added ? 'Remove this driver' : 'Delete this driver',
            icon: 'delete_outline',
            onClick: () => {
              if (driverRefs.length && !window.confirm(
                `${outRef(driver.ref)} has ${driverRefs.length} cable(s) on it. `
                + 'They go back to the tray. Continue?')) return;
              dispatch({ type: 'REMOVE_DRIVER', ref: driver.ref });
            },
          },
        ]} />
      </div>
      {driver.maxPowerW != null ? (
        <Tooltip content={driver.driverRestrictions || 'Driver Restrictions'}>
          <div className="bin-capacity">
            <span className="cap-title text-secondary">driver total</span>
            <div className="slot-fill flex-grow-1">
              <div className={pct > 100 ? 'bg-fail' : 'bg-ok'} style={{ width: `${Math.min(pct, 100)}%` }} />
            </div>
            <span className={`small ${pct > 100 ? 'text-danger fw-bold' : 'text-secondary'}`}>
              {load.toFixed(1)}/{driver.maxPowerW}W{pct > 100 && ' FAIL'}
            </span>
          </div>
        </Tooltip>
      ) : (
        /* No MaxPower(W) on the type, so there is no bar to draw and no capacity
           to check. That is worth a sentence, not a question mark. */
        <button type="button" className="bin-capacity bin-undet" onClick={() => setShowUndet(true)}>
          <span className="material-icons">help_outline</span>
          <span className="small">undetermined · {load.toFixed(1)}W</span>
        </button>
      )}
      {driver.nodes.map((node) => (
        <Slot key={node.name} driver={driver} node={node} state={state} dispatch={dispatch}
          links={links} flagIndex={flagIndex} onNodeClick={onNodeClick} groups={groups} />
      ))}
      {showFlags && (
        <FlagDialog driver={driver} flags={driverFlags} links={links}
          onClose={() => setShowFlags(false)} />
      )}
      {showUndet && (
        <UndeterminedDialog driver={driver} load={load} onClose={() => setShowUndet(false)} />
      )}
    </div>
  );
}

// What "undetermined" means, since a question mark on its own is a question.
function UndeterminedDialog({ driver, load, onClose }) {
  return (
    <div className="nt-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="fd-dialog" role="dialog" aria-label="Undetermined capacity">
        <div className="fd-head">
          <span className="fd-ref">{outRef(driver.ref)}</span>
          <span className="fd-name">{driver.name || driver.typeName || driver.typeRef}</span>
          <button className="btn btn-sm btn-link ms-auto p-0" onClick={onClose}>close</button>
        </div>
        <ul className="fd-list">
          <li>
            <b>No MaxPower(W) on {driver.typeRef}</b>
            <span>
              There is no capacity to fill, so no bar is drawn and nothing is checked
              against it. Cables can still be assigned; they are just not counted.
            </span>
          </li>
          <li>
            <b>{load.toFixed(1)}W assigned so far</b>
            <span>Added up from the cables on it, with nothing to compare it to.</span>
          </li>
        </ul>
        <div className="fd-foot">
          <span className="text-secondary small">
            Fill in MaxPower(W) on Driver types to turn the checks on.
          </span>
          <button className="btn btn-sm btn-link ms-auto" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
