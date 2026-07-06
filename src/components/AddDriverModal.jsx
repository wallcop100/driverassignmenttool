import { useState } from 'react';

export default function AddDriverModal({ model, zone, dispatch, onClose }) {
  const [typeRef, setTypeRef] = useState(model.inventory[0]?.typeRef ?? '');

  return (
    <div className="modal d-block modal-backdrop-custom" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Add driver to {zone}</h5>
            <button className="btn-close" onClick={onClose} />
          </div>
          <div className="modal-body">
            <p className="text-secondary small">
              Types come from the loaded Driver Assignment CSV. The new driver gets a
              placeholder ref (E9xxxx) to be resolved in DesignDB later.
            </p>
            <select className="form-select" size={Math.min(model.inventory.length, 8)}
              value={typeRef} onChange={(e) => setTypeRef(e.target.value)}>
              {model.inventory.map((t) => (
                <option key={t.typeRef} value={t.typeRef}>
                  {t.typeRef} — {t.driverRestrictions || 'no restrictions'} · {t.nodes.length}CH
                </option>
              ))}
            </select>
          </div>
          <div className="modal-footer">
            <button className="btn btn-outline-secondary" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={!typeRef}
              onClick={() => { dispatch({ type: 'ADD_DRIVER', typeRef, zone }); onClose(); }}>
              Add driver
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
