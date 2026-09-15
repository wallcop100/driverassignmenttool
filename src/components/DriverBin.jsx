import { useState } from 'react';
import { cgColor, driverLoad, driverStatus, isPending, keyOf, outRef, severityOf } from '../state.js';
import Block from './Block.jsx';
import FlagDialog from './FlagDialog.jsx';
import KebabMenu from './KebabMenu.jsx';
import Tooltip from './Tooltip.jsx';
import Origin from './Origin.jsx';
import { useDomain } from '../core/domain.js';


// One reading of "how full", used by every bar a domain hands over.
const pctOf = (c) => (c.cap ? Math.round((100 * c.used) / c.cap) : 0);

function Bar({ used, cap, unit, projected, title }) {
  const pct = cap ? Math.round((100 * used) / cap) : 0;
  const over = pct > 100;
  // A domain may hand over a figure with NO cap - a count of runs on a bus,
  // where the segment's allowance is a different quantity entirely. That is a
  // reading, not a gauge: no bar to fill, and no "/" with nothing after it.
  const uncapped = cap == null;
  return (
    <div className="node-metric" title={title}>
      {!uncapped && (
        <div className="slot-fill">
          <div className={over ? 'bg-fail' : 'bg-ok'} style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
      )}
      <span className={`metric-label ${uncapped ? 'ms-auto text-secondary' : ''} ${over ? 'text-danger fw-bold' : 'text-secondary'}`}>
        {projected != null ? <b>→ {projected.toFixed(1)}</b>
          : uncapped ? Math.round(used) : used.toFixed(1)}
        {uncapped ? '' : `/${cap}`}{unit}
      </span>
    </div>
  );
}

function Slot({ driver, node, state, dispatch, links, flagIndex, onNodeClick, groups }) {
  const domain = useDomain();
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

  const cgs = [...new Set(placed.map((l) => domain.groupOf(l)).filter(Boolean))];
  const cg = cgs.length === 1 ? cgs[0] : null;
  const manyOk = domain.slotAllowsManyGroups(driver, node);

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
        <span className="fw-semibold">{node.name || '-'}</span>
        {cgs.length > 1 ? (
          <Tooltip content={manyOk
            ? `Carries ${cgs.length} ${domain.groupLabel} - a shared segment takes several by design`
            : `Serves multiple ${domain.groupLabel}: ${cgs.join(', ')}`}>
            <span className={`cg-chip ${manyOk ? 'cg-many' : 'cg-split'}`}>{cgs.join(' / ')}</span>
          </Tooltip>
        ) : cg ? (
          <span className="cg-chip" style={{ background: cgColor(cg, groups).bg, color: cgColor(cg, groups).text }}>
            {cg}
          </span>
        ) : null}
        <span className="ms-auto d-flex align-items-center gap-1">
          {node.maxLoadW == null && node.maxFvV == null && (
            <span className="text-secondary metric-label">
              {domain.slotSummary(driver, node, { watts: nodeWatts })}
            </span>
          )}
          <KebabMenu title="Node actions" items={[{
            label: 'Return all to tray', icon: 'undo', disabled: !entry.refs.length,
            onClick: () => dispatch({ type: 'MOVE_MANY', linkRefs: entry.refs, toKey: null }),
          }]} />
        </span>
      </div>

      {/* What a capacity MEANS is the domain's business - which watt cap binds
          this output, whether a forward-voltage limit exists at all. The slot
          draws whatever bars it is handed. */}
      {domain.slotCapacities(driver, node, {
        watts: nodeWatts, fv: seriesFv,
        count: placed.length,
        links: placed,
        ghostWatts: ghost ? nodeWatts + (dragLink.loadW ?? 0) : null,
        ghostFv: ghost ? seriesFv + (dragLink.fvV ?? 0) : null,
      }).map((c, i) => (
        <Bar key={i} used={c.used} cap={c.cap} unit={c.unit} title={c.title}
          projected={c.projected} />
      ))}

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
  // ALL flags for this driver - must not filter out node/link-scoped ones, since
  // TypeMatch/CVVoltage/CurrentMatch (CC/CV + mA checks) always carry those.
  const driverFlags = flagIndex.byDriver.get(driver.ref) ?? [];
  const [showFlags, setShowFlags] = useState(false);
  const [showUndet, setShowUndet] = useState(false);
  const severity = severityOf(driverFlags);
  const fail = severity === 'FAIL';
  const mismatch = severity === 'MISMATCH';
  const warn = severity === 'WARN';
  const domain = useDomain();
  const caps = domain.capacities(driver, { assignments: state.assignments, links });
  const badge = domain.badge(driver);
  const load = caps[0]?.used ?? 0;
  const width = domain.widthOf(driver);

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
        {/* added here, so not in the DesignDB yet - the same dashed-and-dotted
            language a moved cable and a corrected type use */}
        {driver.added && <span className="type-added">added</span>}
        {badge && (
          <span className={`type-chip type-${badge.kind}`}>{badge.text}</span>
        )}
        {/* the same mark a moved cable carries: a dot means you changed this and
            it is not in the DesignDB yet */}
        {state.presets?.[driver.typeRef] && (
          <Origin kind={state.presets[driver.typeRef].origin ?? 'edited'} what={driver.typeRef} />
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
      {caps.map((c, i) => (c.cap != null ? (
        <Tooltip key={i} content={c.title}>
          <div className="bin-capacity">
            <span className="cap-title text-secondary">{c.label}</span>
            <div className="slot-fill flex-grow-1">
              <div className={pctOf(c) > 100 ? 'bg-fail' : 'bg-ok'}
                style={{ width: `${Math.min(pctOf(c), 100)}%` }} />
            </div>
            <span className={`small ${pctOf(c) > 100 ? 'text-danger fw-bold' : 'text-secondary'}`}>
              {c.used.toFixed(1)}/{c.cap}{c.unit}{pctOf(c) > 100 && ' FAIL'}
            </span>
          </div>
        </Tooltip>
      ) : (
        /* No declared limit, so there is no bar to draw and no capacity to
           check. That is worth a sentence, not a question mark. */
        <button key={i} type="button" className="bin-capacity bin-undet"
          onClick={() => setShowUndet(true)}>
          <span className="material-icons">help_outline</span>
          <span className="small">undetermined · {c.used.toFixed(1)}{c.unit}</span>
        </button>
      )))}
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
            <b>{caps[0] ? `${caps[0].used.toFixed(1)}${caps[0].unit}` : ''} assigned so far</b>
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
