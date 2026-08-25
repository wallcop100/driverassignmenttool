import { useEffect, useState } from 'react';
import * as api from '../api.js';

// Ratings come from the driver type library when the host sends one; without it
// a per-hub payload has only the types already present, usually with no
// restrictions declared — hence the "not declared" fallback rather than a blank.
function rating(t) {
  if (t.powerType === 'CC' && t.currentA != null) return `${t.currentA}A`;
  if (t.powerType === 'CV' && t.outputVoltageV != null) return `${t.outputVoltageV}V`;
  return null;
}

// canSuggest: the hub has no drivers at all. Sizing a hub from scratch is a
// different job from adding one driver to a hub someone already designed —
// there the existing drivers carry decisions this tool cannot see, so it does
// not get to propose a layout over the top of them.
export default function AddDriverModal({ state, zone, dispatch, onClose, canSuggest }) {
  const { model, assignments, addedDrivers, prefs } = state;
  const [typeRef, setTypeRef] = useState(model.inventory[0]?.typeRef ?? '');
  const [plan, setPlan] = useState(null);
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
  }, [canSuggest, zone, assignments, addedDrivers, prefs.restrictControlGroup, prefs.margin]);

  const applyPlan = () => {
    dispatch({ type: 'APPLY_PLAN', drivers: plan.drivers, placements: plan.placements });
    onClose();
  };
  const setPref = (p) => dispatch({ type: 'SET_PREFS', prefs: p });
  const marginPct = Math.round((prefs.margin ?? 0) * 100);

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
            <div className="type-list" role="listbox">
              {model.inventory.map((t) => {
                const r = rating(t);
                return (
                  <button key={t.typeRef} type="button" role="option"
                    aria-selected={t.typeRef === typeRef}
                    className={`type-row ${t.typeRef === typeRef ? 'is-selected' : ''}`}
                    onClick={() => setTypeRef(t.typeRef)}
                    onDoubleClick={add}>
                    <span className={`type-power ${t.powerType ? `is-${t.powerType.toLowerCase()}` : 'is-unknown'}`}>
                      {t.powerType ?? '—'}
                    </span>
                    <span className="type-ref">{t.typeRef}</span>
                    <span className="type-spec">
                      {t.maxPowerW != null && <b>{t.maxPowerW}W</b>}
                      {r && <> · <b>{r}</b></>}
                      {t.maxPowerW == null && !r && <i className="text-secondary">rating not declared</i>}
                    </span>
                    <span className="type-ch">{t.nodes.length}CH</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="modal-footer">
            <button className="btn btn-outline-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={!typeRef} onClick={add}>Add driver</button>
          </div>
        </div>
      </div>
    </div>
  );
}
