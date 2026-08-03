import { useState } from 'react';

// Ratings come from the driver type library when the host sends one; without it
// a per-hub payload has only the types already present, usually with no
// restrictions declared — hence the "not declared" fallback rather than a blank.
function rating(t) {
  if (t.powerType === 'CC' && t.currentA != null) return `${t.currentA}A`;
  if (t.powerType === 'CV' && t.outputVoltageV != null) return `${t.outputVoltageV}V`;
  return null;
}

export default function AddDriverModal({ model, zone, dispatch, onClose }) {
  const [typeRef, setTypeRef] = useState(model.inventory[0]?.typeRef ?? '');
  const add = () => { dispatch({ type: 'ADD_DRIVER', typeRef, zone }); onClose(); };

  return (
    <div className="modal d-block modal-backdrop-custom" onClick={onClose}>
      <div className="modal-dialog modal-dialog-scrollable" onClick={(e) => e.stopPropagation()}>
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Add driver to {zone}</h5>
            <button className="btn-close" onClick={onClose} />
          </div>
          <div className="modal-body p-0">
            <p className="text-secondary small px-3 pt-3 mb-2">
              The new driver gets a placeholder ref (E9xxxx) to be resolved in DesignDB later.
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
