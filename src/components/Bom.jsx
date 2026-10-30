import { useMemo } from 'react';
import { resolveSpec } from '../engine.js';
import { bom } from '../drivers/recipe.js';

// The bill of materials for a hub's drivers, as [typeRef, qty, jboxes] (see recipe.bom).
export default function Bom({ counts, inventory, className = '' }) {
  // keyed on the content: the layout hands a new array on every drag frame
  const key = JSON.stringify(counts);
  const parts = useMemo(() => bom(counts, inventory, resolveSpec), [key, inventory]);
  if (!parts.length) return null;
  return (
    <details className={`est-bom ${className}`}>
      <summary>Bill of materials</summary>
      <table className="table table-sm mb-0">
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
    </details>
  );
}
