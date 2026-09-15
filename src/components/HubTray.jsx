import Origin from './Origin.jsx';
import { outRef } from '../state.js';

// What the hub holds but nobody has placed yet: the assign page's tray, for
// equipment. An Element whose ContextParameters say no bay and no [x,y,z] waits
// here; drag it into a bay to place it, or drag a block back here to take it out.
// Grouped by type with a count, because an early design says "4 of these" long
// before anyone says where.
export default function HubTray({ items, dragging, trayRef, onPick, onHover, onBreakApart }) {
  const groups = new Map();
  for (const i of items) {
    if (!groups.has(i.typeRef)) groups.set(i.typeRef, []);
    groups.get(i.typeRef).push(i);
  }
  const units = items.reduce((n, i) => n + (i.qty ?? 1), 0);

  return (
    <aside ref={trayRef} className={`hub-tray ${dragging && !dragging.fromTray ? 'is-target' : ''} ${dragging?.overTray ? 'is-over' : ''}`}
      aria-label="Not placed yet"
      onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}>
      <div className="hub-tray-head">
        <span className="material-icons small-icon">inventory_2</span>
        Not placed <span className="text-secondary">· {units}</span>
      </div>
      {!items.length && (
        <div className="hub-tray-empty text-secondary small">
          Everything in this hub is placed. Drag a block here to take it out.
        </div>
      )}
      {[...groups].map(([typeRef, list]) => (
        <div key={typeRef} className="hub-tray-group">
          <div className="hub-tray-type" title={typeRef}>
            <span className="rv-ref">{typeRef}</span>
            <span className="text-secondary">{list.reduce((n, i) => n + (i.qty ?? 1), 0)}</span>
          </div>
          {list.map((i) => (
            <div key={i.ref} className={`hub-tray-item ${dragging?.ref === i.ref ? 'is-dragging' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); onPick(i.ref); }}
              title="Drag into a bay to place it">
              <span className="material-icons hub-tray-grip">drag_indicator</span>
              <span className="hub-tray-ref">{outRef(i.ref)}</span>
              {i.qty > 1 && <span className="hub-tray-qty">×{i.qty}</span>}
              {i.size ? <span className="text-secondary">{Math.round(i.size[0])} × {Math.round(i.size[1])}</span> : null}
              {i.sizedBy && i.sizedBy !== 'db' && <Origin kind={i.sizedBy} what={`${outRef(i.ref)}'s size`} />}
              {i.qty > 1 && (
                <button type="button" className="btn btn-sm btn-link p-0 ms-auto"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => onBreakApart(i.ref)} title="One row per driver">break apart</button>
              )}
            </div>
          ))}
        </div>
      ))}
    </aside>
  );
}
