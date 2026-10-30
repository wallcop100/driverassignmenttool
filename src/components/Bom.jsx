import { useMemo } from 'react';
import { resolveSpec } from '../engine.js';
import { bom } from '../drivers/recipe.js';

// The bill of materials for a hub's drivers, as [typeRef, qty, jboxes] (see recipe.bom).
export default function Bom({ counts, inventory, title, onClose }) {
  // keyed on the content: the layout hands a new array on every drag frame
  const key = JSON.stringify(counts);
  const parts = useMemo(() => bom(counts, inventory, resolveSpec), [key, inventory]);
  return (
    <div className="hub-bom" role="region" aria-label="Bill of Materials">
      <div className="hub-bom-head">
        <span className="material-icons small-icon">receipt_long</span>
        Bill of Materials <span className="text-secondary fw-normal">· {title}</span>
        <button type="button" className="btn-close ms-auto" aria-label="Hide the Bill of Materials" onClick={onClose} />
      </div>
      {parts.length ? (
        <table className="table table-sm mb-0">
          <thead><tr><th>Qty</th><th>ElementType</th><th>Part</th></tr></thead>
          <tbody>
            {parts.map((p) => (
              <tr key={`${p.kind}|${p.ref}|${p.item}`}>
                <td className="est-bom-n">{p.qty}</td>
                <td className="rv-ref">{p.ref ?? ''}</td>
                <td>{p.item}{p.kind === 'unmatched' && <span className="text-secondary"> (no datasheet match)</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <div className="text-secondary">No drivers in this hub yet.</div>}
      <div className="hub-bom-foot">Placed and not placed · feed provisions left out</div>
    </div>
  );
}
