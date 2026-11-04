import { useState } from 'react';
import Origin from './Origin.jsx';
import { outRef } from '../state.js';

// What the hub holds but nobody has placed yet: the assign page's tray, for
// equipment. An Element whose ContextParameters say no bay and no [x,y,z] waits
// here; drag it into a bay to place it, or drag a block back here to take it out.
// Grouped by type with a count, because an early design says "4 of these" long
// before anyone says where. A size is the type's, so it sits on the group (7EQPAA).
export default function HubTray({ items, dragging, trayRef, selected = [], onToggle, onPick, onHover, onBreakApart }) {
  const [shut, setShut] = useState([]);   // typeRefs folded away
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
      {[...groups].map(([typeRef, list]) => {
        const open = !shut.includes(typeRef);
        const { size, sizedBy } = list[0];
        return (
          <div key={typeRef} className="hub-tray-group">
            <button type="button" className="hub-tray-type" title={typeRef} aria-expanded={open}
              onClick={() => setShut((s) => (open ? [...s, typeRef] : s.filter((t) => t !== typeRef)))}>
              <span className="material-icons">{open ? 'expand_more' : 'chevron_right'}</span>
              <span className="rv-ref">{typeRef}</span>
              {sizedBy && sizedBy !== 'db' && <Origin kind={sizedBy} what={`${typeRef}'s size`} />}
              <span className="text-secondary">
                {size ? `${Math.round(size[0])} × ${Math.round(size[1])} · ` : ''}{list.reduce((n, i) => n + (i.qty ?? 1), 0)}
              </span>
            </button>
            {open && list.map((i) => (
              <div key={i.ref}
                className={`hub-tray-item ${(dragging?.refs ?? [dragging?.ref]).includes(i.ref) ? 'is-dragging' : ''} ${selected.includes(i.ref) ? 'is-sel' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (e.shiftKey || e.ctrlKey || e.metaKey) onToggle(i.ref);
                  else onPick(i.ref);
                }}
                title="Drag into a bay to place it. Ctrl or Shift+click to pick several.">
                <span className="material-icons hub-tray-grip">drag_indicator</span>
                <span className="hub-tray-ref">{outRef(i.ref)}</span>
                {i.qty > 1 && <span className="hub-tray-qty">×{i.qty}</span>}
                {i.qty > 1 && (
                  <button type="button" className="btn btn-sm btn-link p-0 ms-auto"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => onBreakApart(i.ref)} title="One row per driver">break apart</button>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </aside>
  );
}
