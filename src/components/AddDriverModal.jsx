import { useEffect, useMemo, useState } from 'react';
import * as api from '../api.js';
import { nextTypeRef, STOCK_TYPES } from '../engine.js';
import { assignedRefs, isProvision } from '../state.js';

// Ratings come from the driver type library when the host sends one; without it
// a per-hub payload has only the types already present, usually with no
// restrictions declared — hence the "not declared" fallback rather than a blank.
function rating(t) {
  if (t.powerType === 'CC' && t.currentA != null) return `${t.currentA}A`;
  if (t.powerType === 'CV' && t.outputVoltageV != null) return `${t.outputVoltageV}V`;
  return null;
}

// A type in the catalogue, as the editor holds it. Everything is nullable: the
// point of the editor is that these are the values nobody declared.
const draftFrom = (t) => ({
  typeRef: t.typeRef,
  powerType: t.powerType ?? 'CC',
  maxPowerW: t.maxPowerW ?? '',
  currentA: t.currentA ?? '',
  outputVoltageV: t.outputVoltageV ?? '',
  channels: t.nodes?.length ?? 1,
  nodeNames: t.nodes?.map((n) => n.name) ?? null,
  nodeMaxLoadW: t.nodes?.[0]?.maxLoadW ?? '',
  nodeMaxFvV: t.nodes?.[0]?.maxFvV ?? '',
  invented: false,
});

const numOrNull = (v) => (v === '' || v == null ? null : Number(v));

// The page-135910 drivers, as an editor draft. Blank cells stay blank — on that
// page a blank means "no check", and inventing a limit here would invent a rule.
const draftFromStock = (t) => ({
  typeRef: '', invented: true, stock: t.name,
  powerType: t.powerType,
  maxPowerW: t.maxPowerW ?? '',
  currentA: t.currentA ?? '',
  outputVoltageV: t.outputVoltageV ?? '',
  channels: t.channels,
  nodeNames: null,
  nodeMaxLoadW: t.nodeMaxLoadW ?? '',
  nodeMaxFvV: t.nodeMaxFvV ?? '',
  nodeCurrentA: t.nodeCurrentA ?? null,
  ballast: t.ballast ?? null,
  controlType: t.controlType ?? null,
  stem: t.stem ?? null,
});

// Saved shape — numbers, not form strings.
const toPreset = (d) => ({
  typeRef: d.typeRef.trim(),
  powerType: d.powerType,
  maxPowerW: numOrNull(d.maxPowerW),
  currentA: d.powerType === 'CC' ? numOrNull(d.currentA) : null,
  outputVoltageV: d.powerType === 'CV' ? numOrNull(d.outputVoltageV) : null,
  channels: Math.max(1, Number(d.channels) || 1),
  nodeNames: d.nodeNames ?? null,
  nodeCurrentA: d.nodeCurrentA ?? null,
  ballast: d.ballast ?? null,
  controlType: d.controlType ?? null,
  nodeMaxLoadW: numOrNull(d.nodeMaxLoadW),
  nodeMaxFvV: numOrNull(d.nodeMaxFvV),
  invented: !!d.invented,
});

// Enough to size against: without a declared type, rating and max power, the
// planner refuses it anyway (sizingCandidates) and we would have saved a preset
// that changes nothing.
const isComplete = (d) => !!d.typeRef.trim() && numOrNull(d.maxPowerW) > 0
  && (d.powerType === 'CC' ? numOrNull(d.currentA) > 0 : numOrNull(d.outputVoltageV) > 0);

function PresetEditor({ draft, setDraft, inventory, onSave, onCancel, onDelete }) {
  const set = (patch) => setDraft({ ...draft, ...patch });
  // The ref encodes the spec in this library, so it is re-proposed as the
  // ratings change — until the user types their own, after which it is theirs.
  const [ownRef, setOwnRef] = useState(false);
  useEffect(() => {
    if (!draft.invented || ownRef) return;
    const next = nextTypeRef(inventory, {
      powerType: draft.powerType,
      currentA: numOrNull(draft.currentA),
      outputVoltageV: numOrNull(draft.outputVoltageV),
      channels: Math.max(1, Number(draft.channels) || 1),
      stem: draft.stem,
    });
    if (next && next !== draft.typeRef) set({ typeRef: next });
  }, [draft.powerType, draft.currentA, draft.outputVoltageV, draft.channels, ownRef]);

  const field = (label, key, extra = {}) => (
    <label className="preset-field">
      <span>{label}</span>
      <input className="form-control form-control-sm" type="number" min="0" step="any"
        value={draft[key]} onChange={(e) => set({ [key]: e.target.value })} {...extra} />
    </label>
  );

  return (
    <div className="preset-editor px-3 py-3">
      <div className="d-flex align-items-center gap-2 mb-2">
        <strong className="small">{draft.invented ? 'New driver type' : `Ratings for ${draft.typeRef}`}</strong>
        <span className="badge text-bg-warning ms-auto">provisional</span>
      </div>

      {draft.invented && (
        <div className="stock-row mb-2">
          <span className="text-secondary">Start from</span>
          {STOCK_TYPES.map((t) => (
            <button key={t.name} type="button"
              className={`stock-chip ${draft.stock === t.name ? 'is-on' : ''}`}
              onClick={() => setDraft({ ...draftFromStock(t), typeRef: '' })}>
              {t.name}
            </button>
          ))}
        </div>
      )}

      {draft.invented && (
        <label className="preset-field mb-2 w-100">
          <span>Type ref</span>
          <input className="form-control form-control-sm" value={draft.typeRef}
            onChange={(e) => { setOwnRef(true); set({ typeRef: e.target.value }); }} />
        </label>
      )}

      <div className="preset-grid">
        <label className="preset-field">
          <span>Type</span>
          <select className="form-select form-select-sm" value={draft.powerType}
            onChange={(e) => set({ powerType: e.target.value })}>
            <option value="CC">CC</option>
            <option value="CV">CV</option>
          </select>
        </label>
        {field('Max power (W)', 'maxPowerW')}
        {draft.powerType === 'CC'
          ? field('Current (A)', 'currentA')
          : field('Output (V)', 'outputVoltageV')}
        {field('Channels', 'channels', { min: '1', step: '1' })}
        {field('Node max (W)', 'nodeMaxLoadW')}
        {field('Node max fV', 'nodeMaxFvV')}
      </div>

      <p className="text-secondary mt-2 mb-2" style={{ fontSize: '12px' }}>
        Patched into the workbook’s <code>ElementTypes</code> row and marked
        <code> IsPropertiesTBC</code>. Current is written in amps, and the channels
        become <code>Parameters</code> — <code>{'{<OP.1,<OP.2}'}</code>.
        {draft.stock && ' Values are the documented ones for this driver; a blank cell means no check.'}
      </p>

      <div className="d-flex gap-2">
        <button className="btn btn-sm btn-primary" disabled={!isComplete(draft)} onClick={onSave}>
          Save preset
        </button>
        <button className="btn btn-sm btn-outline-secondary" onClick={onCancel}>Cancel</button>
        {onDelete && (
          <button className="btn btn-sm btn-link text-danger ms-auto" onClick={onDelete}>
            Remove preset
          </button>
        )}
      </div>
    </div>
  );
}

// canSuggest: the hub has no drivers at all. Sizing a hub from scratch is a
// different job from adding one driver to a hub someone already designed —
// there the existing drivers carry decisions this tool cannot see, so it does
// not get to propose a layout over the top of them.
export default function AddDriverModal({ state, zone, dispatch, onClose, canSuggest }) {
  const { model, assignments, addedDrivers, prefs, presets } = state;
  const [typeRef, setTypeRef] = useState(model.inventory[0]?.typeRef ?? '');
  const [plan, setPlan] = useState(null);
  const [draft, setDraft] = useState(null);
  const add = () => { dispatch({ type: 'ADD_DRIVER', typeRef, zone }); onClose(); };

  // Re-planned on every knob turn: the preview IS the plan that gets applied,
  // so there is no way for the two to disagree.
  useEffect(() => {
    if (!canSuggest) return undefined;
    let stale = false;
    api.plan(zone, assignments, addedDrivers, {
      restrictControlGroup: prefs.restrictControlGroup,
      margin: prefs.margin,
    }).then((p) => !stale && setPlan(p)).catch(console.error);
    return () => { stale = true; };
  }, [canSuggest, zone, assignments, addedDrivers, prefs.restrictControlGroup, prefs.margin, model]);

  const applyPlan = () => {
    dispatch({ type: 'APPLY_PLAN', drivers: plan.drivers, placements: plan.placements });
    onClose();
  };
  const setPref = (p) => dispatch({ type: 'SET_PREFS', prefs: p });
  const marginPct = Math.round((prefs.margin ?? 0) * 100);

  // "define a type" opens on the electrical shape of whatever is still in the
  // tray — the common case is a cable nothing in the library can take.
  const orphanShape = useMemo(() => {
    const assigned = assignedRefs(assignments);
    const cable = model.links.find((l) => l.zone === zone && !assigned.has(l.ref) && !isProvision(l));
    return cable
      ? { powerType: cable.powerType, currentA: cable.currentA ?? '', outputVoltageV: cable.voltageV ?? '' }
      : { powerType: 'CC', currentA: '', outputVoltageV: '' };
  }, [model, zone, assignments]);

  const defineNew = () => setDraft({
    typeRef: '', maxPowerW: '', channels: 2, nodeMaxLoadW: '', nodeMaxFvV: '',
    invented: true, ...orphanShape,
  });

  const savePreset = () => {
    dispatch({ type: 'SET_PRESET', preset: toPreset(draft) });
    setTypeRef(draft.typeRef.trim());
    setDraft(null);
  };
  const deletePreset = () => { dispatch({ type: 'DELETE_PRESET', typeRef: draft.typeRef }); setDraft(null); };

  return (
    <div className="modal d-block modal-backdrop-custom" onClick={onClose}>
      <div className="modal-dialog modal-dialog-scrollable" onClick={(e) => e.stopPropagation()}>
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Add drivers to {zone}</h5>
            <button className="btn-close" onClick={onClose} />
          </div>
          <div className="modal-body p-0">
            {canSuggest && (
            <div className="suggest-panel px-3 pt-3">
              <div className="d-flex align-items-center gap-3 flex-wrap">
                <strong className="small">Suggest from the unassigned cables</strong>
                <div className="form-check form-switch mb-0 ms-auto"
                  title="Never put two ControlGroups on the same driver">
                  <input className="form-check-input" type="checkbox" id="restrictCg"
                    checked={!!prefs.restrictControlGroup}
                    onChange={(e) => setPref({ restrictControlGroup: e.target.checked })} />
                  <label className="form-check-label small" htmlFor="restrictCg">One ControlGroup per driver</label>
                </div>
                <label className="small d-flex align-items-center gap-1 mb-0" title="Capacity left free on every driver">
                  Margin
                  <input type="number" className="form-control form-control-sm margin-input"
                    min="0" max="50" step="1" value={marginPct}
                    onChange={(e) => setPref({ margin: Math.min(50, Math.max(0, Number(e.target.value) || 0)) / 100 })} />
                  %
                </label>
              </div>

              <div className="small text-secondary mt-2">
                {!plan ? 'Sizing…'
                  : plan.drivers.length ? (
                    <>
                      {plan.proposals.map((p) => (
                        <div key={p.key}>
                          <b>{p.count} × {p.typeRef}</b> for {p.cables} cable{p.cables > 1 ? 's' : ''} — {p.key}
                        </div>
                      ))}
                      {plan.unplaced.length > 0 && (
                        <div className="text-warn">{plan.unplaced.length} cable(s) still wouldn’t fit.</div>
                      )}
                      {plan.unmatched.map((u) => (
                        <div key={u.key} className="text-warn">
                          {u.count} × {u.key}: no matching driver type in the library.
                        </div>
                      ))}
                    </>
                  ) : 'Nothing to size — every cable in this hub is assigned, or no type matches them.'}
              </div>

              <button className="btn btn-sm btn-primary mt-2 mb-3"
                disabled={!plan?.drivers.length} onClick={applyPlan}>
                Add {plan?.drivers.length ?? 0} driver{plan?.drivers.length === 1 ? '' : 's'} and place cables
              </button>
            </div>
            )}

            <p className="text-secondary small px-3 pt-1 mb-2">
              {canSuggest ? 'Or add one by hand. ' : ''}
              Every added driver exports as the placeholder ref E5000X, resolved in DesignDB later.
            </p>

            {draft ? (
              <PresetEditor draft={draft} setDraft={setDraft} inventory={model.inventory}
                onSave={savePreset} onCancel={() => setDraft(null)}
                onDelete={presets[draft.typeRef] ? deletePreset : null} />
            ) : (
              <>
                <div className="type-list" role="listbox">
                  {model.inventory.map((t) => {
                    const r = rating(t);
                    const patched = !!presets[t.typeRef];
                    return (
                      <div key={t.typeRef} className={`type-row ${t.typeRef === typeRef ? 'is-selected' : ''}`}>
                        <button type="button" role="option" className="type-main"
                          aria-selected={t.typeRef === typeRef}
                          onClick={() => setTypeRef(t.typeRef)}
                          onDoubleClick={add}>
                          <span className={`type-power ${t.powerType ? `is-${t.powerType.toLowerCase()}` : 'is-unknown'}`}>
                            {t.powerType ?? '—'}
                          </span>
                          <span className="type-ref">
                            {t.typeRef}
                            {patched && <span className="badge text-bg-warning ms-2 preset-badge">preset</span>}
                          </span>
                          <span className="type-spec">
                            {t.maxPowerW != null && <b>{t.maxPowerW}W</b>}
                            {r && <> · <b>{r}</b></>}
                            {t.maxPowerW == null && !r && <i className="text-secondary">rating not declared</i>}
                          </span>
                          <span className="type-ch">{t.nodes.length}CH</span>
                        </button>
                        <button type="button" className="type-edit" title={`Edit ratings for ${t.typeRef}`}
                          aria-label={`Edit ratings for ${t.typeRef}`}
                          onClick={() => setDraft(draftFrom(presets[t.typeRef] ? { ...t, ...presets[t.typeRef], nodes: t.nodes } : t))}>
                          <span className="material-icons small-icon">edit</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
                <button type="button" className="define-type-link" onClick={defineNew}>
                  define a type…
                </button>
              </>
            )}
          </div>
          <div className="modal-footer">
            <button className="btn btn-outline-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={!typeRef || !!draft} onClick={add}>Add driver</button>
          </div>
        </div>
      </div>
    </div>
  );
}
