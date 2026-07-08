import { useState } from 'react';

const LEVEL_ICON = { FAIL: 'error', MISMATCH: 'report' };
const PULSE_MS = 4300; // matches .tour-pulse: 1.4s × 3 iterations, plus a hair

const escape = (s) => (window.CSS?.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&'));

// Jump to and flash whichever entity an issue is actually about: the specific
// cable if it names one, else the node, else the whole driver card.
function locate(issue) {
  const sel = issue.link ? `[data-link="${escape(issue.link)}"]`
    : issue.node != null ? `[data-node="${escape(`${issue.driver}|${issue.node}`)}"]`
    : `[data-driver="${escape(issue.driver)}"]`;
  const el = document.querySelector(sel);
  if (!el) return; // hidden by a filter/toggle right now — nothing to point at
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('tour-pulse');
  setTimeout(() => el.classList.remove('tour-pulse'), PULSE_MS);
}

// Hover popup for the zone header's "N issues" badge: lists each actionable
// (FAIL/MISMATCH) flag, and clicking one scrolls to + pulses the entity it's about.
export default function IssuesBadge({ issues }) {
  const [open, setOpen] = useState(false);
  if (!issues.length) return null;

  return (
    <span className="issues-badge" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <span className="badge badge-fail">{issues.length} issue{issues.length > 1 ? 's' : ''}</span>
      {open && (
        // .issues-pop's own box (incl. its top padding) sits flush against the
        // badge with no gap, so the cursor never leaves it while crossing from
        // badge to rows — see styles.css for why that matters.
        <div className="issues-pop">
          <div className="issues-pop-inner">
            {issues.map((f) => (
              <button key={f.key} className="issues-row" onClick={() => { locate(f); setOpen(false); }}>
                <span className={`material-icons small-icon ${f.level === 'FAIL' ? 'text-fail' : 'text-mismatch'}`}>
                  {LEVEL_ICON[f.level]}
                </span>
                <span className="issues-row-text">
                  <b>{[f.driver, f.node, f.link].filter(Boolean).join(' · ')}</b>
                  <span className="text-secondary">{f.message}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </span>
  );
}
