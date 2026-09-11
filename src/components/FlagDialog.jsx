import { outRef } from '../state.js';

// Every check a driver failed, in full. This was a hover tooltip on a small
// purple glyph — which told you something was wrong, in a colour that means
// nothing on its own, and then took the explanation away the moment you moved
// the mouse toward it.
//
// Grouped by check rather than by cable: "three cables are 350mA on a 500mA
// driver" is one problem with three cables in it, not three problems.
const LEVELS = {
  FAIL: ['error', 'A hard failure — the design will not work as assigned.'],
  MISMATCH: ['report', 'The driver and the cable disagree about type, voltage or current.'],
  WARN: ['warning', 'Worth a look; not necessarily wrong.'],
  INFO: ['info', 'Expected, and shown for completeness.'],
};

export default function FlagDialog({ driver, flags, links, onClose }) {
  const byCheck = new Map();
  for (const f of flags) {
    const key = `${f.level}·${f.check}·${f.message}`;
    if (!byCheck.has(key)) byCheck.set(key, { ...f, links: [], nodes: new Set() });
    const g = byCheck.get(key);
    if (f.link) g.links.push(f.link);
    if (f.node) g.nodes.add(f.node);
  }
  const order = ['FAIL', 'MISMATCH', 'WARN', 'INFO'];
  const groups = [...byCheck.values()]
    .sort((a, b) => order.indexOf(a.level) - order.indexOf(b.level));

  return (
    <div className="nt-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="fd-dialog" role="dialog" aria-label="What is wrong with this driver">
        <div className="fd-head">
          <span className="fd-ref">{outRef(driver.ref)}</span>
          <span className="fd-name">{driver.name || driver.typeName || driver.typeRef}</span>
          <button className="btn btn-sm btn-link ms-auto p-0" onClick={onClose}>close</button>
        </div>

        <ul className="fd-list">
          {groups.map((g) => {
            const [icon, what] = LEVELS[g.level] ?? LEVELS.WARN;
            return (
              <li key={`${g.level}${g.check}${g.message}`} className={`fl-${g.level.toLowerCase()}`}>
                <b>
                  <span className="material-icons">{icon}</span>
                  {g.message}
                </b>
                <span>{what}</span>
                {(g.links.length > 0 || g.nodes.size > 0) && (
                  <span className="fl-where">
                    {g.nodes.size > 0 && `${[...g.nodes].sort().join(', ')}`}
                    {g.links.length > 0 && (
                      <>
                        {g.nodes.size > 0 && ' · '}
                        {g.links.length} cable{g.links.length === 1 ? '' : 's'}:{' '}
                        {g.links.map((r) => links?.[r]?.ref ?? r).join(', ')}
                      </>
                    )}
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        <div className="fd-foot">
          <span className="text-secondary small">
            Checked against what the ElementType states, so wrong ratings give wrong checks.
          </span>
          <button className="btn btn-sm btn-link ms-auto" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
