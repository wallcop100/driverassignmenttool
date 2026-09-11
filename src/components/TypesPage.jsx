import { useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../api.js';
import { bannedNodes, fixNodeName, needsSetup, resolveSpec, statedAttributes } from '../engine.js';
import { effectiveDrivers } from '../state.js';
import { canFill, canReplace, currentOptions, faults, fixPreset, fmt } from '../typeFaults.js';
import FaultDialog from './FaultDialog.jsx';
import NewTypeDialog from './NewTypeDialog.jsx';
import SetupWizard from './SetupWizard.jsx';
import PresetEditor, { draftFrom, toPreset } from './PresetEditor.jsx';
import TypeCard from './TypeCard.jsx';

// The design's driver ElementTypes, one card each. Two jobs, one screen: reached
// from a hub it adds a driver to it, reached on its own it is the catalogue to
// audit and correct. They were two pages for a while, which was worth doing —
// it is what forced the card — but once both drew the same card in the same grid
// the only difference left was one button, and a page is too much to carry for
// a button.

export default function TypesPage({ state, dispatch, zone }) {
  const { model, presets, addedDrivers, assignments, prefs } = state;
  const [q, setQ] = useState('');
  const [editKey, setEditKey] = useState(null);
  const [draft, setDraft] = useState(null);
  const [menu, setMenu] = useState(null);
  const [adding, setAdding] = useState(false);
  const [warn, setWarn] = useState(null);
  const [plan, setPlan] = useState(null);
  const [setup, setSetup] = useState(false);

  // Nothing in this tool works against a project whose driver types state none
  // of the V4.6 attributes, and the fix is the same few rows for the whole job.
  // Judged on what the DesignDB says, so it stays true while you fill them in
  // here: the offer only goes away once it is patched and re-sent.
  const unset = model.inventory.filter((t) => statedAttributes(t) === 0).length;
  const onboarding = needsSetup(model);

  // ':' is banned inside a node name. Correcting it is a rename, so it is safe
  // to do for the whole job at once — and it has to be, because a node written
  // that way is referenced from hubs this session never opens.
  const banned = useMemo(() => bannedNodes(model), [model]);

  const drivers = useMemo(() => effectiveDrivers(model, addedDrivers, state.deletedDrivers),
    [model, addedDrivers, state.deletedDrivers]);
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

  // types this hub already has drivers of, as against the whole library
  const inHub = useMemo(
    () => new Set(zone ? drivers.filter((d) => d.zone === zone).map((d) => d.typeRef) : []),
    [drivers, zone],
  );

  // A hub with no drivers can be sized from its cables; one that already has
  // them carries decisions this tool cannot see.
  const canSuggest = !!zone && !inHub.size;
  useEffect(() => {
    if (!canSuggest) return undefined;
    let stale = false;
    api.plan(zone, assignments, addedDrivers, {
      restrictControlGroup: prefs.restrictControlGroup, margin: prefs.margin,
    }).then((p) => !stale && setPlan(p)).catch(console.error);
    return () => { stale = true; };
  }, [canSuggest, zone, assignments, addedDrivers, prefs.restrictControlGroup, prefs.margin, model]);

  // From a hub, the type you want is usually one this hub already uses; on the
  // catalogue, the reason you opened it is the flagged ones.
  const needle = q.trim().toLowerCase();
  const cards = useMemo(() => model.inventory
    .map((t) => {
      const spec = resolveSpec(t.name || t.typeRef);
      return { t, spec, f: faults(t, spec) };
    })
    .filter(({ t }) => !needle || t.typeRef.toLowerCase().includes(needle)
      || (t.name ?? '').toLowerCase().includes(needle))
    .sort((a, b) => (zone
      ? (inHub.has(b.t.typeRef) - inHub.has(a.t.typeRef))
        || (usage.get(b.t.typeRef)?.count ?? 0) - (usage.get(a.t.typeRef)?.count ?? 0)
      : (b.f.length > 0) - (a.f.length > 0))
      || a.t.typeRef.localeCompare(b.t.typeRef)),
  [model.inventory, needle, zone, inHub, usage]);

  const flagged = cards.filter((c) => c.f.length).length;
  const closeEdit = () => { setEditKey(null); setDraft(null); };
  const zoneCables = zone ? model.links.filter((l) => l.zone === zone && l.powerType).length : 0;

  return (
    <div className="container-fluid py-3 types-page">
      <div className="dp-head">
        <button className="btn btn-sm btn-outline-secondary d-flex align-items-center"
          onClick={() => dispatch({
            type: 'SET_VIEW',
            view: zone ? { page: 'zone', zone } : { page: 'landing' },
          })}>
          <span className="material-icons small-icon">arrow_back</span> {zone ?? 'Zones'}
        </button>
        <h5 className="mb-0">{zone ? `Add a driver to ${zone}` : 'Driver types'}</h5>
        {/* Where the list came from. Embedded, the host posts the whole project's
            type library alongside this hub's drivers — so if this says the hub's
            own count, the library did not arrive and that is the thing to chase. */}
        <span className="text-secondary small">
          {model.inventory.length} type{model.inventory.length === 1 ? '' : 's'}
          {zone ? ` available · ${inHub.size} already in ${zone}` : ' in the design'}
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

      {banned.length > 0 && (
        <div className="dp-suggest sw-offer is-banned">
          <div>
            <b>
              {banned.length} driver type{banned.length === 1 ? '' : 's'} use a colon in a node name
            </b>
            <div className="text-secondary small">
              {banned.flatMap((b) => b.nodes.map((n) => `${n.from} → ${n.to}`)).join(' · ')}
              {'. '}
              The colon is spoken for elsewhere in Parameters syntax. Correcting it is a
              rename, so nothing moves off its node. The patch sweeps LinksMap too,
              including hubs not open here.
            </div>
          </div>
          <button className="btn btn-sm btn-primary ms-auto"
            onClick={() => dispatch({
              type: 'FIX_NODE_SYNTAX',
              types: banned.map((b) => ({
                typeRef: b.t.typeRef,
                nodeNames: b.t.nodes.map((n) => fixNodeName(n.name)),
              })),
            })}>
            Correct {banned.reduce((n, b) => n + b.nodes.length, 0)} node
            {banned.reduce((n, b) => n + b.nodes.length, 0) === 1 ? '' : 's'}
          </button>
        </div>
      )}

      {onboarding && (
        <div className="dp-suggest sw-offer">
          <div>
            <b>None of this project’s {model.inventory.length} driver types have their attributes filled in</b>
            <div className="text-secondary small">
              Watts, current, outputs and forward voltage all live on ElementTypes.
              Without them nothing can be sized or checked. The datasheet fills in
              most of it; the patch adds the columns if the workbook predates them.
            </div>
          </div>
          <button className="btn btn-sm btn-primary ms-auto" onClick={() => setSetup(true)}>
            Fill them in
          </button>
        </div>
      )}
      {/* part way through: the offer becomes a count */}
      {!onboarding && unset > 0 && Object.keys(presets).length > 0 && (
        <div className="dp-suggest sw-offer is-part">
          <div>
            <b>{unset} of {model.inventory.length} driver types still have nothing filled in</b>
            <div className="text-secondary small">Patch what you have, or carry on through the rest.</div>
          </div>
          <button className="btn btn-sm btn-outline-primary ms-auto" onClick={() => setSetup(true)}>
            Carry on
          </button>
        </div>
      )}

      {canSuggest && plan?.drivers.length > 0 && (
        <div className="dp-suggest">
          <div>
            <b>{zone} has {zoneCables} cables and no drivers yet</b>
            <div className="text-secondary small">
              {plan.proposals.map((p) => `${p.count} × ${p.typeRef}`).join(' · ')} would hold them
              {prefs.restrictControlGroup && ', one ControlGroup each'}
              {plan.unplaced.length > 0 && ` · ${plan.unplaced.length} wouldn’t fit`}
            </div>
          </div>
          <button className="btn btn-sm btn-primary ms-auto"
            onClick={() => {
              dispatch({ type: 'APPLY_PLAN', drivers: plan.drivers, placements: plan.placements });
              dispatch({ type: 'SET_VIEW', view: { page: 'zone', zone } });
            }}>
            Add these {plan.drivers.length} drivers
          </button>
        </div>
      )}

      <div className="tp-grid">
        {cards.map(({ t, spec, f }) => (
          <TypeRow key={t.typeRef} t={t} spec={spec} f={f} usage={usage.get(t.typeRef)}
            zone={zone} dispatch={dispatch} presets={presets} inventory={model.inventory}
            editing={editKey === t.typeRef} draft={draft} setDraft={setDraft}
            openEdit={() => { setEditKey(t.typeRef); setDraft(draftFrom(t)); setMenu(null); }}
            closeEdit={closeEdit}
            menuOpen={menu === t.typeRef}
            toggleMenu={() => setMenu(menu === t.typeRef ? null : t.typeRef)}
            closeMenu={() => setMenu(null)}
            inHub={inHub.has(t.typeRef)}
            onWarn={() => setWarn({ t, spec, f })} />
        ))}
        {!cards.length && (
          <div className="tp-empty text-secondary">
            {needle ? `Nothing matches “${q}”.` : 'No driver types in this design yet.'}
          </div>
        )}
      </div>

      {warn && (
        <FaultDialog t={warn.t} spec={warn.spec} faults={warn.f}
          onClose={() => setWarn(null)}
          onFix={(mode, a) => {
            dispatch({ type: 'SET_PRESET', preset: fixPreset(warn.t, warn.spec, mode, a) });
            setWarn(null);
          }} />
      )}
      {adding && (
        <NewTypeDialog zone={zone} inventory={model.inventory} dispatch={dispatch}
          onClose={() => setAdding(false)} />
      )}
      {setup && (
        <SetupWizard model={model} presets={presets} dispatch={dispatch}
          onClose={() => setSetup(false)} />
      )}
    </div>
  );
}

function TypeRow(props) {
  const { t, spec, f, usage, zone, dispatch, presets, inventory, editing, draft, setDraft,
    openEdit, closeEdit, menuOpen, toggleMenu, closeMenu, onWarn, inHub } = props;
  const opts = currentOptions(t, spec);
  const fill = canFill(t, spec);
  const replace = canReplace(t, spec);
  const apply = (mode, a) => {
    dispatch({ type: 'SET_PRESET', preset: fixPreset(t, spec, mode, a) });
    closeMenu();
  };

  return (
    <TypeCard t={t} faults={f} usage={usage} onWarn={onWarn}
      className={`${editing ? 'is-editing' : ''} ${inHub ? 'is-here' : ''}`}
      below={editing ? (
        <PresetEditor draft={draft} setDraft={setDraft} inventory={inventory}
          onSave={() => { dispatch({ type: 'SET_PRESET', preset: toPreset(draft) }); closeEdit(); }}
          onCancel={closeEdit}
          onDelete={presets[draft.typeRef]
            ? () => { dispatch({ type: 'DELETE_PRESET', typeRef: draft.typeRef }); closeEdit(); }
            : null} />
      ) : null}>
      <button className="tp-icon" title="Edit the fields" onClick={editing ? closeEdit : openEdit}>
        <span className="material-icons">{editing ? 'close' : 'edit'}</span>
      </button>
      <Menu open={menuOpen} toggle={toggleMenu} close={closeMenu}>
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
        {!fill && !replace && !t.preset && opts.length < 2 && (
          <span className="tp-menu-none">Nothing to fix</span>
        )}
      </Menu>
      {/* the one thing that differs between arriving from a hub and arriving
          on your own — not enough to be a second page */}
      {zone && (
        <button className="btn btn-sm btn-primary tp-add" onClick={() => {
          dispatch({ type: 'ADD_DRIVER', typeRef: t.typeRef, zone });
          dispatch({ type: 'SET_VIEW', view: { page: 'zone', zone } });
        }}>Add</button>
      )}
    </TypeCard>
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
