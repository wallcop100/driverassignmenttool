import { useMemo } from 'react';
import { resolveSpec } from '../engine.js';
import { bom } from '../drivers/recipe.js';

// The bill of materials for a set of drivers, as [typeRef, count] pairs: the
// assessment passes its estimate, a hub page the drivers actually in it.
export default function Bom({ counts, inventory, className = '' }) {
  const parts = useMemo(() => bom(counts, inventory, resolveSpec), [counts, inventory]);
  if (!parts.length) return null;
  return (
    <details className={`est-bom ${className}`}>
      <summary>Bill of materials</summary>
      <table className="table table-sm mb-0">
        <tbody>
          {parts.map((p) => (
            <tr key={`${p.kind}|${p.item}`}>
              <td className="est-bom-n">{p.qty}</td>
              <td>{p.item}{p.kind === 'unmatched' && <span className="text-secondary"> (no datasheet match)</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
