import { useState } from 'react';
import { checkOf, setSharedParts } from '../engine.js';
import { conflicts, partRows } from '../catalogue.js';
import { useCompanion } from '../companion.js';
import { openReport } from '../bugReports.js';

// A shared part one person has vouched for, asked of the next person to use it -
// PS&R's way (certainty.js), in PS&R's companion card (ConfirmSuggestionModal):
// sending a part is the sender's yes, a second person's yes makes it agreed, and
// two people saying no more often than yes takes it out of the catalogue. Only
// the button pressed is sent, for the version shown: an amended part is a new
// claim and is asked about again.
const KEY = 'dat.sharedCheck';
const said = () => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}; } catch { return {}; } };
const remember = (rev, v) => {
  try { localStorage.setItem(KEY, JSON.stringify({ ...said(), [rev]: v })); } catch { /* private window */ }
};

// PS&R's flag beside a suggestion: a bug note pinned to it, so a bad one is said where it was seen.
// The note records the flag's label (first 60 characters), so it names the part first.
export function ReportSuggestion({ what }) {
  return (
    <button type="button" className="sug-flag" title="Report a problem with this suggestion" aria-label={`Report suggested ${what}`}
      onClick={(e) => { e.preventDefault(); openReport(e.currentTarget); }}>
      <span className="material-icons">flag</span>
    </button>
  );
}

export default function SharedCheck({ part }) {
  const companion = useCompanion();
  const [answered, setAnswered] = useState(null);
  const [error, setError] = useState(null);
  if (checkOf(part) !== 'unchecked' || !part.rev) return null;
  const mine = answered ?? said()[part.rev];
  const v = part.votes ?? {};
  const off = conflicts(part);
  const wrong = Object.keys(off).length > 0;

  const vote = async (choice) => {
    setError(null);
    const r = await companion.parts.vote(part.name, part.rev, choice);
    if (r.error) { setError(r.error); return; }
    remember(part.rev, choice);
    setAnswered(choice);
    setSharedParts(r.parts);
  };

  return (
    <div className="companion-card shared-check" data-testid="shared-check">
      <div className="sc-head">
        <span className="material-icons" style={{ fontSize: 15 }}>fact_check</span>
        Are these ratings right for {part.name}?
      </div>
      {wrong && !mine && (
        <div className="sc-warn" data-testid="shared-check-off">
          <span className="material-icons" style={{ fontSize: 15 }}>warning_amber</span>
          These look wrong: {Object.keys(off).join(', ')} {Object.keys(off).length === 1 ? 'does' : 'do'} not match its datasheet.
        </div>
      )}
      <table className="table table-sm mb-1">
        <thead><tr><th /><th>Sent by someone using this tool</th></tr></thead>
        <tbody>
          {v.no ? <tr><th>Others</th><td>{v.no} said it is wrong</td></tr> : null}
          {partRows(part).map(([k, val]) => <tr key={k} className={off[k] ? 'is-off' : undefined}><th>{k}</th><td>
            {val}{off[k] && <span className="sc-off"> · {off[k]}</span>}
          </td></tr>)}
        </tbody>
      </table>
      <div className="sc-foot">
        <span className="text-muted" style={{ flex: 1 }}>
          {mine
            ? (mine === 'confirmed' ? 'Thanks.' : 'Noted - fill these in by hand if they are wrong.')
            : wrong
              ? 'Please double check this against the datasheet now - your answer decides whether other projects use it.'
              : 'Please double check this now - nothing fills in from it until a second person agrees.'}
        </span>
        {!mine && companion?.parts?.vote && (
          <>
            <button type="button" className={`btn btn-sm ${wrong ? 'btn-outline-primary' : 'btn-info'}`} onClick={() => vote('confirmed')}>Yes, they're right</button>
            <button type="button" className={`btn btn-sm ${wrong ? 'btn-info' : 'btn-outline-primary'}`} onClick={() => vote('rejected')}>No, they're wrong</button>
            <button type="button" className="btn btn-sm btn-link p-0" onClick={() => vote('unsure')}>Not sure</button>
          </>
        )}
      </div>
      {error && <div className="small text-danger">{error}</div>}
    </div>
  );
}
