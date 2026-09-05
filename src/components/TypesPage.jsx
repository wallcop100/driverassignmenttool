import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveSpec } from '../engine.js';
import { effectiveDrivers } from '../state.js';
import {
  canFill, canReplace, currentOptions, faults, fixPreset, fmt, ratingsOf, zoneList,
} from '../typeFaults.js';
import NewTypeDialog from './NewTypeDialog.jsx';
import PresetEditor, { draftFrom, toPreset } from './PresetEditor.jsx';

// The design's driver ElementTypes, one card each. This screen exists to answer
// "is what the DesignDB says about this driver right, and if not, fix it" — so a
// card shows what it states, flags what looks wrong, and holds the whole record
// one press away. Adding a driver to a hub is a different job and lives in
// DriverPicker; the two used to share a list and neither fitted it.

export default function TypesPage({ state, dispatch, zone }) {
  const { model, presets, addedDrivers } = state;
  const [q, setQ] = useState('');
  const [editKey, setEditKey] = useState(null);
  const [draft, setDraft] = useState(null);
  const [menu, setMenu] = useState(null);
  const [adding, setAdding] = useState(false);

  const drivers = useMemo(() => effectiveDrivers(model, addedDrivers), [model, addedDrivers]);
  const usage = useMemo(() => {
    const by = new Map();
    for (const d of drivers) {
      const cur = by.get(d.typeRef) ?? { count: 0, zones: new Set() };
      cur.count += 1;
      if (d.zone) cur.zones.add(d.zone);
      by.set(d.typeRef, cur);
    }
    return by;
  }, [drivers]);

  // Flagged first — the reason to open this screen is at the top of it.
  const needle = q.trim().toLowerCase();
  const cards = useMemo(() => model.inventory
    .map((t) => ({ t, spec: resolveSpec(t.name || t.typeRef), f: faults(t, resolveSpec(t.name || t.typeRef)) }))
    .filter(({ t }) => !needle || t.typeRef.toLowerCase().includes(needle)
      || (t.name ?? '').toLowerCase().includes(needle))
    .sort((a, b) => (b.f.length > 0) - (a.f.length > 0) || a.t.typeRef.localeCompare(b.t.typeRef)),
  [model.inventory, needle]);

  const flagged = cards.filter((c) => c.f.length).length;
  const closeEdit = () => { setEditKey(null); setDraft(null); };

  return (
    <div className="container-fluid py-3 types-page">
      <div className="dp-head">
        <button className="btn btn-sm btn-outline-secondary d-flex align-items-center"
          onClick={() => dispatch({
            type: 'SET_VIEW',
            view: zone ? { page: 'drivers', zone } : { page: 'landing' },
          })}>
          <span className="material-icons small-icon">arrow_back</span> {zone ?? 'Zones'}
        </button>
        <h5 className="mb-0">Driver types</h5>
        <span className="text-secondary small">
          {model.inventory.length} type{model.inventory.length === 1 ? '' : 's'} in the design
        </span>
        {flagged > 0 && (
          <span className="dp-need" title="These types state something the datasheet disagrees with, or nothing at all">
            {flagged} worth a look
          </span>
        )}
        <input className="form-control form-control-sm ms-auto" style={{ maxWidth: 220 }}
          placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}>New type</button>
      </div>

      <div className="tp-grid">
        {cards.map(({ t, spec, f }) => (
          <TypeCard key={t.typeRef} t={t} spec={spec} f={f} usage={usage.get(t.typeRef)}
            zone={zone} dispatch={dispatch} presets={presets} inventory={model.inventory}
            editing={editKey === t.typeRef} draft={draft} setDraft={setDraft}
            openEdit={() => { setEditKey(t.typeRef); setDraft(draftFrom(t)); setMenu(null); }}
            closeEdit={closeEdit}
            menuOpen={menu === t.typeRef}
            toggleMenu={() => setMenu(menu === t.typeRef ? null : t.typeRef)}
            closeMenu={() => setMenu(null)} />
        ))}
        {!cards.length && (
          <div className="tp-empty text-secondary">
            {needle ? `Nothing matches “${q}”.` : 'No driver types in this design yet.'}
          </div>
        )}
      </div>

      {adding && (
        <NewTypeDialog zone={zone} inventory={model.inventory} dispatch={dispatch}
          onClose={() => setAdding(false)} />
      )}
    </div>
  );
}

function TypeCard(props) {
  const { t, spec, f, usage, zone, dispatch, presets, inventory, editing, draft, setDraft,
    openEdit, closeEdit, menuOpen, toggleMenu, closeMenu } = props;
  const opts = currentOptions(t, spec);
  const fill = canFill(t, spec);
  const replace = canReplace(t, spec);
  const apply = (mode, a) => {
    dispatch({ type: 'SET_PRESET', preset: fixPreset(t, spec, mode, a) });
    closeMenu();
  };

  return (
    <div className={`tp-card ${f.length ? 'is-off' : ''} ${editing ? 'is-editing' : ''}`}>
      <div className="tp-card-top">
        <span className="tp-ref">{t.typeRef}</span>
        {t.preset && <span className="tp-dot" title="Changed here, not patched yet">pending</span>}
      </div>
      <div className="tp-line">
        <span className={`type-power ${t.powerType ? `is-${t.powerType.toLowerCase()}` : 'is-unknown'}`}>
          {t.powerType ?? '—'}
        </span>
        <span className="tp-name" title={t.name || ''}>{t.name || '—'}</span>
      </div>
      <div className="tp-spec">{ratingsOf(t)}</div>
      {f.length > 0 && (
        <div className="tp-fault" title={f.map((x) => x[1]).join(' ')}>
          {f.map((x) => x[0]).join(' · ')}
        </div>
      )}
      <div className="tp-foot">
        <span className="tp-use" title={usage ? [...usage.zones].sort().join(', ') : ''}>
          {usage ? `${usage.count} × ${zoneList(usage.zones)}` : 'unused'}
        </span>
        <button className="tp-icon" title="Edit the fields" onClick={editing ? closeEdit : openEdit}>
          <span className="material-icons">{editing ? 'close' : 'edit'}</span>
        </button>
        <Menu open={menuOpen} toggle={toggleMenu} close={closeMenu}>
          {zone && (
            <button onClick={() => {
              dispatch({ type: 'ADD_DRIVER', typeRef: t.typeRef, zone });
              dispatch({ type: 'SET_VIEW', view: { page: 'zone', zone } });
            }}>Add to {zone}</button>
          )}
          {fill && (
            <button onClick={() => apply('fill')}
              title="Adds only what the design states nothing for">
              Fill blanks from {spec.name}
            </button>
          )}
          {replace && (
            <button onClick={() => apply('replace')} className="is-warn"
              title={`Overwrites what disagrees with the ${spec.name} spec page`}>
              Use the spec page ({fmt(spec.maxPowerW)}W)
            </button>
          )}
          {/* the ref and the name disagree about the current, so neither is
              taken on trust — choosing one corrects the Name, never the Ref */}
          {opts.length > 1 && opts.map((o) => (
            <button key={o.from} onClick={() => apply('fill', o.a)}>
              Set CurrentRange to {o.a}A <em>per the {o.from}</em>
            </button>
          ))}
          {t.preset && (
            <button className="is-warn"
              onClick={() => { dispatch({ type: 'DELETE_PRESET', typeRef: t.typeRef }); closeMenu(); }}>
              Discard pending change
            </button>
          )}
          {!zone && !fill && !replace && !t.preset && opts.length < 2 && (
            <span className="tp-menu-none">Nothing to fix</span>
          )}
        </Menu>
      </div>

      {editing && (
        <PresetEditor draft={draft} setDraft={setDraft} inventory={inventory}
          onSave={() => { dispatch({ type: 'SET_PRESET', preset: toPreset(draft) }); closeEdit(); }}
          onCancel={closeEdit}
          onDelete={presets[draft.typeRef]
            ? () => { dispatch({ type: 'DELETE_PRESET', typeRef: draft.typeRef }); closeEdit(); }
            : null} />
      )}
    </div>
  );
}

// The remedies, concealed: a card should read as what the design says, not as a
// row of buttons. Closes on an outside click or Escape like any other menu.
function Menu({ open, toggle, close, children }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!ref.current?.contains(e.target)) close(); };
    const esc = (e) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open, close]);
  return (
    <span className="tp-menu-wrap" ref={ref}>
      <button className="tp-icon" title="More" onClick={toggle} aria-expanded={open}>
        <span className="material-icons">more_vert</span>
      </button>
      {open && <div className="tp-menu">{children}</div>}
    </span>
  );
}
