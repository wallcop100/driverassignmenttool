import { useEffect, useMemo, useState } from 'react';
import * as api from '../api.js';
import { PARTS, combine, resolveSpec } from '../engine.js';
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

// One part and the refs under it. Same row wherever it appears, so the sections
// differ only in what they contain and how loudly they announce it.
function PartRow(props) {
  const { g, open, setOpen, pick, setPick, usage, zone, dispatch, setDraft, addDriver, addFromPart } = props;
  
  const p = g.part;
  const isOpen = open === g.key;
  const choice = pick[g.key] ?? {};
  const psu = PARTS.find((x) => x.name === choice.psu);
  const eff = combine(p, p.kind === 'dcdc' ? psu : null) ?? p;
  const needsCurrent = p.powerType === 'CC' && p.minA != null && p.minA !== p.maxA;
  const needsPsu = p.kind === 'dcdc';
  const ready = (!needsCurrent || numOrNull(choice.currentA) > 0) && (!needsPsu || !!psu);
  // Discontinued parts stay for the refs still using them, but there is
  // no reason to offer one that cannot be bought.
  const gone = !!p.discontinued;
  if (gone && !g.types.length) return null;
  const troubled = g.types.some(({ t, spec }) => faults(t, spec).length);

  return (
    <div key={g.key} className={`dp-part ${isOpen ? 'is-open' : ''} ${gone ? 'is-gone' : ''}`}>
      <button type="button" className="dp-part-head"
  onClick={() => setOpen(isOpen ? null : g.key)}>
  <span className={`type-power is-${p.powerType.toLowerCase()}`}>{p.powerType}</span>
  <span className="dp-name">
    {p.name}
    {gone && <span className="dp-gone">discontinued</span>}
  </span>
  <span className="dp-spec">
    {fmt(eff.maxPowerW)}W
    {p.powerType === 'CC' && p.minA != null
      && ` · ${p.minA === p.maxA ? `${p.minA}A` : `${p.minA}–${p.maxA}A`}`}
    {eff.outputV != null && ` · ${eff.outputV}V`}
    {eff.maxFvV != null && ` · ${eff.maxFvV}fV/out`}
  </span>
  <span className="dp-ch">{eff.outputs ?? 1} out{eff.addresses ? ` · ${eff.addresses}CH` : ''}</span>
  {troubled && <span className="dp-flag" title="One of the types under this part is worth a look">!</span>}
  <span className="dp-count">
    {g.types.length ? `${g.types.length} in use` : ''}
  </span>
      </button>

      {/* the refs this job already uses for that part, folded away until asked for */}
      {isOpen && g.types.map(({ t, spec }) => {
  const f = faults(t, spec);
  const u = usage.get(t.typeRef);
  return (
    <div key={t.typeRef} className={`dp-ref ${f.length ? 'is-off' : ''}`}>
      <span className="dp-ref-id">{t.typeRef}</span>
      {/* what the DesignDB says — never what we propose in its place */}
      <span className="dp-ref-spec">{ratingsOf(t.designDB ?? t)}</span>
      <span className="dp-ref-use">
        {u ? `${u.count} driver${u.count > 1 ? 's' : ''} · ${[...u.zones].sort().join(', ')}` : 'unused'}
      </span>
      {t.invented && <span className="badge text-bg-warning preset-badge">not in DesignDB</span>}
      {f.length > 0 && (
        <span className="dp-fault" title={f.map((x) => x[1]).join(' ')}>
          {f.map((x) => x[0]).join(' · ')}
        </span>
      )}
      <span className="dp-ref-act">
        {zone && (
          <button className="btn btn-sm btn-link p-0 me-2"
            onClick={() => { addDriver(t.typeRef); dispatch({ type: 'SET_VIEW', view: { page: 'zone', zone } }); }}>
            add to {zone}
          </button>
        )}
        <button className="btn btn-sm btn-link p-0" onClick={() => setDraft(
          draftFrom(presets[t.typeRef] ? { ...t, ...presets[t.typeRef], nodes: t.nodes } : t),
        )}>edit</button>
      </span>
      {/* a preset on a real type is a proposed change, shown as one */}
      {t.designDB && (
        <span className="dp-pending">
          pending → {ratingsOf(t)}
          <button className="btn btn-sm btn-link p-0 ms-2"
            onClick={() => dispatch({ type: 'DELETE_PRESET', typeRef: t.typeRef })}>
            discard
          </button>
        </span>
      )}
      {/* nothing proposed, nothing stated, but the spec page knows */}
      {!t.preset && suggestionFor(t, spec) && (
        <span className="dp-suggest">
          spec page says {ratingsOf(suggestionFor(t, spec))}
          <button className="btn btn-sm btn-link p-0 ms-2"
            onClick={() => dispatch({ type: 'SET_PRESET', preset: suggestionFor(t, spec) })}>
            add these
          </button>
        </span>
      )}
    </div>
  );
      })}

      {/* choose what the datasheet cannot: the current, and the supply */}
      {isOpen && (
  <div className="dp-add">
    {needsPsu && (
      <label>
        <span>Supply</span>
        <select className="form-select form-select-sm" value={choice.psu ?? ''}
          onChange={(e) => setPick({ ...pick, [g.key]: { ...choice, psu: e.target.value } })}>
          <option value="">Choose…</option>
          {PARTS.filter((x) => x.kind === 'supply').map((x) => (
            <option key={x.name} value={x.name}>{x.name}</option>
          ))}
        </select>
      </label>
    )}
    {needsCurrent && (
      <label>
        <span>CurrentRange</span>
        <input className="form-control form-control-sm" type="number" step="any"
          placeholder={`${p.minA}–${p.maxA}`} value={choice.currentA ?? ''}
          onChange={(e) => setPick({ ...pick, [g.key]: { ...choice, currentA: e.target.value } })} />
      </label>
    )}
    <span className="dp-newref">
      {ready ? toPreset({
        ...draftFromPart(p, needsPsu ? psu : null),
        currentA: choice.currentA ?? '',
      }).typeRef || '—' : 'choose the values above'}
    </span>
    <button className="btn btn-sm btn-primary ms-auto" disabled={!ready}
      onClick={() => addFromPart(g)}>
      {zone ? `Add to ${zone}` : 'Add type'}
    </button>
    <button className="btn btn-sm btn-link"
      onClick={() => setDraft({ ...draftFromPart(p, needsPsu ? psu : null), currentA: choice.currentA ?? '' })}>
      edit values
    </button>
  </div>
      )}
    </div>
  );
  
}

// One line of ratings, from whichever side of a type is being shown.
const ratingsOf = (t) => [
  t.maxPowerW != null ? `${fmt(t.maxPowerW)}W` : '—',
  t.currentA != null ? `${fmt(t.currentA)}A` : t.outputVoltageV != null ? `${fmt(t.outputVoltageV)}V` : null,
  (t.nodeMaxFvV ?? t.nodes?.[0]?.maxFvV) != null ? `${fmt(t.nodeMaxFvV ?? t.nodes[0].maxFvV)}fV/out` : null,
].filter(Boolean).join(' · ');

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
  const [draft, setDraft] = useState(null);     // full editor, the override path
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
  const inDesign = groups.inDesign.filter(match);
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

  const rowProps = { open, setOpen, pick, setPick, usage, zone, dispatch, setDraft, addDriver, addFromPart };

  const savePreset = () => { dispatch({ type: 'SET_PRESET', preset: toPreset(draft) }); setDraft(null); };
  const removePreset = () => { dispatch({ type: 'DELETE_PRESET', typeRef: draft.typeRef }); setDraft(null); };

  return (
    <div className="container-fluid py-3 drivers-page">
      <div className="dp-head">
        <button className="btn btn-sm btn-outline-secondary d-flex align-items-center"
          onClick={() => dispatch({ type: 'SET_VIEW', view: zone ? { page: 'zone', zone } : { page: 'landing' } })}>
          <span className="material-icons small-icon">arrow_back</span> {zone ?? 'Zones'}
        </button>
        <h5 className="mb-0">{zone ? `Add drivers to ${zone}` : 'Driver types'}</h5>
        <span className="text-secondary small">
          {groups.inDesign.length} in the design · {groups.templated.length} templated
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

      {draft && (
        <div className="dp-editor">
          <PresetEditor draft={draft} setDraft={setDraft} inventory={model.inventory}
            onSave={savePreset} onCancel={() => setDraft(null)}
            onDelete={presets[draft.typeRef] ? removePreset : null} />
        </div>
      )}

      <div className="dp-list">
        <div className="dp-sec">
          In the design
          <span className="dp-sec-n">{inDesign.length} part{inDesign.length === 1 ? '' : 's'}</span>
        </div>
        {inDesign.map((g) => <PartRow key={g.key} g={g} {...rowProps} />)}
        {!inDesign.length && (
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
                      onClick={() => setDraft(draftFrom(t))}>edit</button>
                  </span>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
