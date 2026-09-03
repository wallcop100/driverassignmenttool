import { useEffect, useMemo, useState } from 'react';
import * as api from '../api.js';
import { PARTS, combine, currentFromName, currentFromRef, resolveSpec } from '../engine.js';
import { effectiveDrivers, outRef } from '../state.js';
import PresetEditor, { draftFrom, draftFromPart, rating, toPreset } from './PresetEditor.jsx';

// Driver types — the one place types are chosen, defined and corrected. Reached
// from a hub (then it can add drivers to that hub and size it) or on its own
// (then it is the catalogue).
//
// The list is one alphabetical run of PARTS, not of refs: a part is the thing a
// person recognises, and the refs under it are the currents and supplies this
// job happens to use. That grouping is what makes a wrong one obvious — four
// SoloDrive 360/A refs sitting together, one of them claiming 185W.

const fmt = (n) => (n == null ? null : (Number.isInteger(n) ? n : +n.toFixed(2)));
const numOrNull = (v) => (v === '' || v == null ? null : Number(v));

// What the stated ratings and the spec page disagree about. The part is matched
// on a free-text name, so a mismatch might be the match's fault rather than the
// data's: attribute the number to the page instead of asserting it, and lean on
// the part name in the row above rather than repeating it. Each entry is
// [what the row shows, the full sentence on hover].
function faults(type, spec) {
  // Judge the design's own numbers. A preset is a proposal, and flagging it
  // would be flagging the user's own unsaved answer back at them.
  const t = type.designDB ?? type;
  const out = [];
  if (t.maxPowerW == null) {
    out.push(['no MaxPower(W) — nothing to size against',
      'Without a max power this type cannot be checked or sized against.']);
  } else if (spec?.maxPowerW != null && Math.abs(t.maxPowerW - spec.maxPowerW) > 0.01) {
    const times = t.maxPowerW / spec.maxPowerW;
    out.push([`${t.maxPowerW}W here · spec page says ${fmt(spec.maxPowerW)}W`,
      `This type states ${t.maxPowerW}W. The ${spec.name} spec page says ${fmt(spec.maxPowerW)}W`
      + `${times >= 1.5 ? ` — ${fmt(times)}× higher, so checks against it would pass an overload` : ''}. `
      + `If this is not a ${spec.name}, the name is what matched it.`]);
  }
  if (t.powerType == null) {
    out.push(['no CC/CV — matches no cable', 'With no declared CC/CV type this driver matches nothing.']);
  } else if (t.powerType === 'CC' && t.currentA == null) {
    out.push(['no CurrentRange — reads as undeclared',
      'With CurrentRange empty the driver has no declared current, so it matches no cable.']);
  } else if (t.powerType === 'CV' && t.outputVoltageV == null) {
    out.push(['no OutputVoltage(V)', 'Without an output voltage the CV check cannot run.']);
  } else if (t.powerType === 'CC' && t.currentA != null && spec?.minA != null
    && (t.currentA < spec.minA || t.currentA > spec.maxA)) {
    out.push([`${t.currentA}A · spec page range is ${spec.minA}–${spec.maxA}A`,
      `${t.currentA}A is outside the ${spec.minA}–${spec.maxA}A the ${spec.name} spec page gives.`]);
  }
  return out;
}

// One ElementType, as the design names it. Not folded under its datasheet part:
// the design's name carries the current ("at 1050mA"), which is the whole of
// what separates four otherwise identical SoloDrive types, and a part heading
// throws it away. The matched part surfaces only when it disagrees.
function TypeRow({ t, spec, usage, zone, dispatch, edit, editKey, draft, setDraft, closeEdit,
                  inventory, presets, addDriver, pick, setPick }) {
  const f = faults(t, spec);
  const u = usage.get(t.typeRef);
  const opts = currentOptions(t, spec);
  const chosen = pick[`A:${t.typeRef}`] ?? opts[0]?.a ?? null;
  // Judged against what the card currently shows, pending preset included, so
  // filling the blanks does not take the disagreement button away with it.
  const blanks = t.maxPowerW == null || t.powerType == null
    || (spec?.powerType === 'CC' && t.currentA == null)
    || (t.nodes?.[0]?.maxFvV == null && spec?.maxFvV != null);
  const disagrees = spec?.maxPowerW != null && t.maxPowerW != null
    && Math.abs(t.maxPowerW - spec.maxPowerW) > 0.01;
  const canFix = !!spec && (spec.powerType !== 'CC' || chosen != null);
  const apply = (mode) => dispatch({ type: 'SET_PRESET', preset: fixPreset(t, spec, mode, chosen) });
  const editing = editKey === t.typeRef;

  // One line per type. Every column belongs to the type, but not on the line —
  // the list is for finding a Ref, and eleven columns on each row is a form, not
  // a list. Opening one puts the whole record in place, editable.
  return (
    <div className={`dp-type ${f.length ? 'is-off' : ''} ${editing ? 'is-editing' : ''}`}>
      <div className="dp-type-head">
        {/* the Ref is the key on the Elements sheet, and what people scan for */}
        <span className="dp-type-ref">{t.typeRef}</span>
        <span className={`type-power ${t.powerType ? `is-${t.powerType.toLowerCase()}` : 'is-unknown'}`}>
          {t.powerType ?? '—'}
        </span>
        <span className="dp-type-name">{t.name || '—'}</span>
        <span className="dp-spec">{ratingsOf(t)}</span>
        <span className="dp-count" title={u ? [...u.zones].sort().join(', ') : ''}>
          {u ? `${u.count} × ${zoneList(u.zones)}` : 'unused'}
        </span>
        {t.preset && (
          <button className="dp-chip is-pending" title="Not saved to the DesignDB yet"
            onClick={() => dispatch({ type: 'DELETE_PRESET', typeRef: t.typeRef })}>
            pending · discard
          </button>
        )}
        {/* one click, on the row, without opening anything */}
        {!editing && canFix && blanks && (
          <button className="dp-chip is-fill" onClick={() => apply('fill')}
            title={`Fill every blank column from the ${spec.name} spec page. Stated values are left alone`}>
            Fill blanks
          </button>
        )}
        {!editing && canFix && disagrees && (
          <button className="dp-chip is-replace" onClick={() => apply('replace')}
            title={`Replace what disagrees with the ${spec.name} spec page`}>
            Use {fmt(spec.maxPowerW)}W
          </button>
        )}
        <span className="dp-ref-act">
          {zone && (
            <button className="btn btn-sm btn-link p-0 me-2"
              onClick={() => { addDriver(t.typeRef); dispatch({ type: 'SET_VIEW', view: { page: 'zone', zone } }); }}>
              add
            </button>
          )}
          <button className="btn btn-sm btn-link p-0"
            onClick={() => (editing ? closeEdit() : edit(t.typeRef, draftFrom(t)))}>
            {editing ? 'close' : 'edit'}
          </button>
        </span>
      </div>

      {f.length > 0 && !editing && (
        <div className="dp-fault" title={f.map((x) => x[1]).join(' ')}>
          {f.map((x) => x[0]).join(' · ')}
        </div>
      )}

      {/* the ref and the name disagree about the current, so neither is taken on
          trust — pick one, and the name is corrected to match it */}
      {!editing && opts.length > 1 && (
        <div className="dp-choose">
          <span>{spec.name} runs {spec.minA}–{spec.maxA}A. This one is</span>
          {opts.map((o) => (
            <button key={o.from} type="button"
              className={`dp-pick ${chosen === o.a ? 'is-on' : ''}`}
              onClick={() => setPick({ ...pick, [`A:${t.typeRef}`]: o.a })}>
              {o.a}A <em>per the {o.from}</em>
            </button>
          ))}
        </div>
      )}

      {editing && (
        <Editor draft={draft} setDraft={setDraft} inventory={inventory} presets={presets}
          dispatch={dispatch} closeEdit={closeEdit} />
      )}
    </div>
  );
}

// The editor, mounted inside whichever card was opened — never in a box of its
// own at the top of the page, where the values being edited are out of sight.
function Editor({ draft, setDraft, inventory, presets, dispatch, closeEdit }) {
  return (
    <PresetEditor draft={draft} setDraft={setDraft} inventory={inventory}
      onSave={() => { dispatch({ type: 'SET_PRESET', preset: toPreset(draft) }); closeEdit(); }}
      onCancel={closeEdit}
      onDelete={presets[draft.typeRef]
        ? () => { dispatch({ type: 'DELETE_PRESET', typeRef: draft.typeRef }); closeEdit(); }
        : null} />
  );
}

// A type can be in a dozen hubs; the row must not stretch to name them all.
const zoneList = (zones) => {
  const z = [...zones].sort();
  return z.length > 2 ? `${z[0]} +${z.length - 1}` : z.join(', ');
};

// One line of ratings, from whichever side of a type is being shown.
const ratingsOf = (t) => [
  t.maxPowerW != null ? `${fmt(t.maxPowerW)}W` : '—',
  t.currentA != null ? `${fmt(t.currentA)}A` : t.outputVoltageV != null ? `${fmt(t.outputVoltageV)}V` : null,
  (t.nodeMaxFvV ?? t.nodes?.[0]?.maxFvV) != null ? `${fmt(t.nodeMaxFvV ?? t.nodes[0].maxFvV)}fV/out` : null,
].filter(Boolean).join(' · ');

// The current the design picked out of the datasheet's range. It says so twice —
// in the ref and in the name — and when those disagree neither is authoritative,
// so both are offered and the choice corrects the name to match. The ref is left
// alone: it is the key Elements point at and the key the patch writes against,
// so renaming it is a DesignDB migration, not a button.
export function currentOptions(t, spec) {
  if (spec?.powerType !== 'CC') return [];
  const fromRef = currentFromRef(t.typeRef);
  const fromName = currentFromName(t.name);
  const inRange = (a) => a != null && (spec.minA == null || (a >= spec.minA && a <= spec.maxA));
  if (spec.minA != null && spec.minA === spec.maxA) return [{ a: spec.minA, from: 'spec page' }];
  const out = [];
  if (inRange(fromRef)) out.push({ a: fromRef, from: 'ref' });
  if (inRange(fromName) && fromName !== fromRef) out.push({ a: fromName, from: 'name' });
  return out;
}

// The preset a fix would produce. `mode` is 'fill' — add only what the design
// states nothing for — or 'replace', which also overwrites what disagrees.
// Both go through SET_PRESET, so the result is pending and reviewable either way.
export function fixPreset(t, spec, mode, currentA) {
  if (!spec) return null;
  const d = t.designDB ?? t;
  const take = (mine, theirs) => (mode === 'replace' ? theirs ?? mine : mine ?? theirs);
  const a = currentA ?? currentOptions(t, spec)[0]?.a ?? null;
  // Aligning the name to the chosen current is safe; aligning the ref is not.
  const name = a != null && currentFromName(t.name) != null && currentFromName(t.name) !== a
    ? String(t.name).replace(NAME_MA_G, `${Math.round(a * 1000)}mA`)
    : t.name || spec.name;
  return {
    typeRef: t.typeRef, name, powerType: spec.powerType,
    maxPowerW: take(d.maxPowerW, spec.maxPowerW),
    currentA: spec.powerType === 'CC' ? take(d.currentA, a) : null,
    outputVoltageV: spec.powerType === 'CV' ? take(d.outputVoltageV, spec.outputV) : null,
    outputs: d.nodes?.length ?? spec.outputs ?? 1,
    addresses: take(d.ballast, spec.addresses),
    nodeMaxLoadW: take(d.nodes?.[0]?.maxLoadW, spec.nodeMaxLoadW),
    nodeMaxFvV: take(d.nodes?.[0]?.maxFvV, spec.maxFvV),
    nodeCurrentA: take(d.nodeCurrentA, spec.nodeCurrentA),
    controlType: take(d.controlType, spec.controlType),
    nodeNames: d.nodes?.map((n) => n.name) ?? null,
    invented: false,
  };
}
const NAME_MA_G = /\d{2,4}\s*mA/i;

// What the spec page would fill in for a type that states nothing. Built as the
// preset the editor would build, so there is one path in and one thing to
// review — and offered, never applied. A CC part whose datasheet gives a RANGE
// is not offered: the current is a choice, and guessing it is the whole class of
// error this tool exists to catch.
function suggestionFor(t, spec) {
  if (!spec || t.maxPowerW != null || t.preset) return null;
  const fixedA = spec.powerType === 'CC' && spec.minA != null && spec.minA === spec.maxA ? spec.minA : null;
  if (spec.powerType === 'CC' && fixedA == null) return null;
  return {
    typeRef: t.typeRef, name: spec.name, powerType: spec.powerType,
    maxPowerW: spec.maxPowerW, currentA: fixedA, outputVoltageV: spec.outputV ?? null,
    outputs: spec.outputs ?? t.nodes.length, addresses: spec.addresses ?? null,
    nodeMaxLoadW: spec.nodeMaxLoadW ?? null, nodeMaxFvV: spec.maxFvV ?? null,
    nodeCurrentA: spec.nodeCurrentA ?? null, controlType: spec.controlType ?? null,
    nodeNames: t.nodes.map((n) => n.name), invented: false,
  };
}

export default function DriversPage({ state, dispatch, zone }) {
  const { model, presets, addedDrivers, assignments, prefs } = state;
  const [open, setOpen] = useState(null);       // expanded row key
  const [draft, setDraft] = useState(null);     // the editor, mounted in its own card
  const [editKey, setEditKey] = useState(null); // which card is open
  const [q, setQ] = useState('');
  const [pick, setPick] = useState({});         // per-row current / supply choices
  const [plan, setPlan] = useState(null);

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

  // A hub with no drivers can be sized from its cables; one that already has
  // them carries decisions this tool cannot see.
  const zoneDrivers = zone ? drivers.filter((d) => d.zone === zone) : [];
  const canSuggest = !!zone && !zoneDrivers.length;
  useEffect(() => {
    if (!canSuggest) return undefined;
    let stale = false;
    api.plan(zone, assignments, addedDrivers, {
      restrictControlGroup: prefs.restrictControlGroup, margin: prefs.margin,
    }).then((p) => !stale && setPlan(p)).catch(console.error);
    return () => { stale = true; };
  }, [canSuggest, zone, assignments, addedDrivers, prefs.restrictControlGroup, prefs.margin, model]);

  // ---- one alphabetical list of parts, each with the refs that resolve to it ----
  const groups = useMemo(() => {
    const by = new Map();
    const orphans = [];
    for (const t of model.inventory) {
      const spec = resolveSpec(t.name || t.typeRef);
      const part = spec?.driver ?? (spec?.kind === 'supply' ? spec : spec);
      if (!part) { orphans.push(t); continue; }
      const key = part.name;
      if (!by.has(key)) by.set(key, { key, part, types: [] });
      by.get(key).types.push({ t, spec });
    }
    for (const p of PARTS) {
      if (p.kind === 'supply' || by.has(p.name)) continue;
      by.set(p.name, { key: p.name, part: p, types: [] });
    }
    const list = [...by.values()].sort((a, b) => a.key.localeCompare(b.key));
    // What is in the design, and what we brought to it. A part is in the design
    // when some ref uses it and that ref was not invented here; everything else
    // is a template — a datasheet part nothing uses, or a type made up here.
    const inDesign = list.filter((g) => g.types.some(({ t }) => !t.invented));
    const templated = list.filter((g) => !g.types.some(({ t }) => !t.invented));
    return { list, inDesign, templated, orphans };
  }, [model.inventory]);

  const needle = q.trim().toLowerCase();
  const match = (g) => !needle || g.key.toLowerCase().includes(needle)
    || g.types.some((x) => x.t.typeRef.toLowerCase().includes(needle));
  // the design's own types, flat and in their own names
  const designTypes = groups.inDesign
    .flatMap((g) => g.types.filter(({ t }) => !t.invented))
    .filter(({ t }) => !needle || (t.name ?? '').toLowerCase().includes(needle)
      || t.typeRef.toLowerCase().includes(needle))
    .sort((a, b) => (a.t.name || a.t.typeRef).localeCompare(b.t.name || b.t.typeRef));
  const templated = groups.templated.filter(match);

  // A filter match opens the section it lands in, so folding never hides the
  // thing you just searched for.
  const [showTemplated, setShowTemplated] = useState(false);
  const [showOrphans, setShowOrphans] = useState(false);
  const openTemplated = showTemplated || (!!needle && templated.length > 0);

  const needRatings = model.inventory.filter((t) => {
    const d = t.designDB ?? t;
    return d.powerType == null || d.maxPowerW == null;
  }).length;
  const zoneCables = zone ? model.links.filter((l) => l.zone === zone && l.powerType).length : 0;

  // ---- actions ----
  const addDriver = (typeRef) => dispatch({ type: 'ADD_DRIVER', typeRef, zone });

  // Adding a datasheet part means defining the ElementType and, from a hub, an
  // instance of it in one go.
  const addFromPart = (g) => {
    const choice = pick[g.key] ?? {};
    const psu = PARTS.find((p) => p.name === choice.psu);
    const d = draftFromPart(g.part, g.part.kind === 'dcdc' ? psu : null);
    const preset = toPreset({ ...d, currentA: choice.currentA ?? '', typeRef: choice.ref || d.typeRef });
    if (!preset.typeRef) return;
    dispatch({ type: 'SET_PRESET', preset });
    if (zone) addDriver(preset.typeRef);
    setOpen(null);
  };

  const edit = (key, d) => { setEditKey(key); setDraft(d); };
  const closeEdit = () => { setEditKey(null); setDraft(null); };
  const rowProps = { open, setOpen, pick, setPick, usage, zone, dispatch, edit, editKey, draft, setDraft,
    closeEdit, inventory: model.inventory, presets, addDriver, addFromPart };

  return (
    <div className="container-fluid py-3 drivers-page">
      <div className="dp-head">
        <button className="btn btn-sm btn-outline-secondary d-flex align-items-center"
          onClick={() => dispatch({ type: 'SET_VIEW', view: zone ? { page: 'zone', zone } : { page: 'landing' } })}>
          <span className="material-icons small-icon">arrow_back</span> {zone ?? 'Zones'}
        </button>
        <h5 className="mb-0">{zone ? `Add drivers to ${zone}` : 'Driver types'}</h5>
        <span className="text-secondary small">
          {designTypes.length} in the design · {groups.templated.length} templated
        </span>
        {needRatings > 0 && (
          <span className="dp-need" title="These types state no ratings, so nothing can be sized against them">
            {needRatings} type{needRatings > 1 ? 's' : ''} need ratings
          </span>
        )}
        <input className="form-control form-control-sm ms-auto" style={{ maxWidth: 240 }}
          placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

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

      <div className="dp-list">
        <div className="dp-sec">
          In the design
          <span className="dp-sec-n">{designTypes.length} type{designTypes.length === 1 ? '' : 's'}</span>
        </div>
        {designTypes.map(({ t, spec }) => (
          <TypeRow key={t.typeRef} t={t} spec={spec} {...rowProps} />
        ))}
        {!designTypes.length && (
          <div className="dp-ref is-plain text-secondary">
            {needle ? `Nothing in the design matches “${q}”.` : 'No driver types in this design yet.'}
          </div>
        )}

        {/* Everything we brought rather than found: a type invented here, or a
            datasheet part nothing in the design uses. Folded, so the list above
            is only ever the design's own. */}
        <button type="button" className="dp-sec is-fold" onClick={() => setShowTemplated(!showTemplated)}>
          <span className="dp-caret">{openTemplated ? '▾' : '▸'}</span>
          Templated — not in this design
          <span className="dp-sec-n">{templated.length} part{templated.length === 1 ? '' : 's'}</span>
        </button>
        {openTemplated && templated.map((g) => <PartRow key={g.key} g={g} {...rowProps} />)}

        {groups.orphans.length > 0 && !needle && (
          <>
            <button type="button" className="dp-sec is-fold" onClick={() => setShowOrphans(!showOrphans)}>
              <span className="dp-caret">{showOrphans ? '▾' : '▸'}</span>
              No datasheet
              <span className="dp-sec-n">{groups.orphans.length} ref{groups.orphans.length === 1 ? '' : 's'}</span>
            </button>
            {showOrphans && groups.orphans.map((t) => {
              const u = usage.get(t.typeRef);
              return (
                <div key={t.typeRef} className="dp-ref is-plain">
                  <span className="dp-ref-id">{t.typeRef}</span>
                  <span className="dp-ref-spec">{t.name || '—'}</span>
                  <span className="dp-ref-use">{u ? `${u.count} driver${u.count > 1 ? 's' : ''}` : 'unused'}</span>
                  <span className="dp-ref-act">
                    {zone && (
                      <button className="btn btn-sm btn-link p-0 me-2"
                        onClick={() => { addDriver(t.typeRef); dispatch({ type: 'SET_VIEW', view: { page: 'zone', zone } }); }}>
                        add to {zone}
                      </button>
                    )}
                    <button className="btn btn-sm btn-link p-0"
                      onClick={() => (editKey === t.typeRef ? closeEdit() : edit(t.typeRef, draftFrom(t)))}>
                      {editKey === t.typeRef ? 'close' : 'edit'}
                    </button>
                  </span>
                  {editKey === t.typeRef && (
                    <Editor draft={draft} setDraft={setDraft} inventory={model.inventory}
                      presets={presets} dispatch={dispatch} closeEdit={closeEdit} />
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
