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

// What the datasheet and the stated ratings disagree about, in the fewest words
// that still name the column.
function faults(t, spec) {
  const out = [];
  if (t.maxPowerW == null) out.push('no MaxPower(W)');
  else if (spec?.maxPowerW != null && Math.abs(t.maxPowerW - spec.maxPowerW) > 0.01) {
    out.push(`datasheet ${fmt(spec.maxPowerW)}W`);
  }
  if (t.powerType == null) out.push('no CC/CV');
  else if (t.powerType === 'CC' && t.currentA == null) out.push('no CurrentRange');
  else if (t.powerType === 'CV' && t.outputVoltageV == null) out.push('no OutputVoltage(V)');
  if (t.powerType === 'CC' && t.currentA != null && spec?.minA != null
    && (t.currentA < spec.minA || t.currentA > spec.maxA)) {
    out.push(`outside ${spec.minA}–${spec.maxA}A`);
  }
  return out;
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
    return { list, orphans };
  }, [model.inventory]);

  const needle = q.trim().toLowerCase();
  const match = (g) => !needle || g.key.toLowerCase().includes(needle)
    || g.types.some((x) => x.t.typeRef.toLowerCase().includes(needle));
  const shown = groups.list.filter(match);

  const undeclared = model.inventory.filter((t) => t.powerType == null || t.maxPowerW == null).length;

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
          {model.inventory.length} in this job · {PARTS.length} on datasheet
        </span>
        {undeclared > 0 && (
          <span className="badge badge-warn" title="No ratings, so they cannot be sized against">
            {undeclared} undeclared
          </span>
        )}
        <input className="form-control form-control-sm ms-auto" style={{ maxWidth: 240 }}
          placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {canSuggest && plan?.drivers.length > 0 && (
        <div className="dp-suggest">
          <div>
            <b>Size {zone} from its cables</b>
            <div className="text-secondary small">
              {plan.proposals.map((p) => `${p.count} × ${p.typeRef}`).join(' · ')}
              {plan.unplaced.length > 0 && ` · ${plan.unplaced.length} wouldn’t fit`}
            </div>
          </div>
          <button className="btn btn-sm btn-primary ms-auto"
            onClick={() => {
              dispatch({ type: 'APPLY_PLAN', drivers: plan.drivers, placements: plan.placements });
              dispatch({ type: 'SET_VIEW', view: { page: 'zone', zone } });
            }}>
            Add {plan.drivers.length} and place cables
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
        {shown.map((g) => {
          const p = g.part;
          const isOpen = open === g.key;
          const choice = pick[g.key] ?? {};
          const psu = PARTS.find((x) => x.name === choice.psu);
          const eff = combine(p, p.kind === 'dcdc' ? psu : null) ?? p;
          const needsCurrent = p.powerType === 'CC' && p.minA != null && p.minA !== p.maxA;
          const needsPsu = p.kind === 'dcdc';
          const ready = (!needsCurrent || numOrNull(choice.currentA) > 0) && (!needsPsu || !!psu);

          return (
            <div key={g.key} className={`dp-part ${isOpen ? 'is-open' : ''}`}>
              <button type="button" className="dp-part-head"
                onClick={() => setOpen(isOpen ? null : g.key)}>
                <span className={`type-power is-${p.powerType.toLowerCase()}`}>{p.powerType}</span>
                <span className="dp-name">{p.name}</span>
                <span className="dp-spec">
                  {fmt(eff.maxPowerW)}W
                  {p.powerType === 'CC' && p.minA != null
                    && ` · ${p.minA === p.maxA ? `${p.minA}A` : `${p.minA}–${p.maxA}A`}`}
                  {eff.outputV != null && ` · ${eff.outputV}V`}
                  {eff.maxFvV != null && ` · ${eff.maxFvV}fV/out`}
                </span>
                <span className="dp-ch">{eff.outputs ?? 1} out{eff.addresses ? ` · ${eff.addresses}CH` : ''}</span>
                <span className="dp-count">
                  {g.types.length ? `${g.types.length} ref${g.types.length > 1 ? 's' : ''}` : 'datasheet'}
                </span>
              </button>

              {/* the refs this job actually uses for that part */}
              {g.types.map(({ t, spec }) => {
                const f = faults(t, spec);
                const u = usage.get(t.typeRef);
                return (
                  <div key={t.typeRef} className={`dp-ref ${f.length ? 'is-off' : ''}`}>
                    <span className="dp-ref-id">{t.typeRef}</span>
                    <span className="dp-ref-spec">
                      {t.maxPowerW != null ? `${t.maxPowerW}W` : '—'}
                      {rating(t) && ` · ${rating(t)}`}
                      {t.nodes[0]?.maxFvV != null && ` · ${t.nodes[0].maxFvV}fV`}
                    </span>
                    <span className="dp-ref-use">
                      {u ? `${u.count} driver${u.count > 1 ? 's' : ''} · ${[...u.zones].sort().join(', ')}` : 'unused'}
                    </span>
                    {presets[t.typeRef] && <span className="badge text-bg-warning preset-badge">preset</span>}
                    {f.length > 0 && <span className="dp-fault">{f.join(' · ')}</span>}
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
        })}

        {groups.orphans.length > 0 && !needle && (
          <>
            <div className="dp-sub">No datasheet</div>
            {groups.orphans.map((t) => {
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
