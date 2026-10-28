import { useState } from 'react';
import { checkOf, setSharedParts } from '../engine.js';
import { useCompanion } from '../companion.js';

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

const g = (n) => (Number.isInteger(n) ? n : +n.toFixed(2));

// The ratings as the part states them, so the check is against something you can see.
const rows = (p) => [
  ['Type', `${p.powerType}${p.kind === 'supply' ? ' supply' : ''}`],
  ['MaxPower(W)', p.maxPowerW],
  ['Current', p.minA == null ? null : p.minA === p.maxA ? `${g(p.minA)}A` : `${g(p.minA)}–${g(p.maxA)}A`],
  ['OutputVoltage(V)', p.outputV],
  ['Max fV', p.maxFvV],
  ['Outputs', p.outputs],
  ['Addresses', p.addresses],
  ['ControlType', p.controlType],
  ['Per current', p.windows?.length
    ? p.windows.map((w) => `${g(w.a * 1000)}mA ${g(w.w)}W${w.fv != null ? `/${g(w.fv)}fV` : ''}`).join(' · ') : null],
].filter(([, v]) => v != null && v !== '');

export default function SharedCheck({ part }) {
  const companion = useCompanion();
  const [answered, setAnswered] = useState(null);
  const [error, setError] = useState(null);
  if (checkOf(part) !== 'unchecked' || !part.rev) return null;
  const mine = answered ?? said()[part.rev];
  const v = part.votes ?? {};

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
        Check {part.name}
      </div>
      <table className="table table-sm mb-1">
        <tbody>
          <tr><th>From</th><td>
            {part.source
              ? <>found online - <a href={part.source} target="_blank" rel="noreferrer noopener">the datasheet</a></>
              : 'someone using this tool'}
            {v.no ? <span className="text-muted"> · {v.no} said it is wrong</span> : null}
          </td></tr>
          {rows(part).map(([k, val]) => <tr key={k}><th>{k}</th><td>{val}</td></tr>)}
        </tbody>
      </table>
      <div className="sc-foot">
        <span className="text-muted" style={{ flex: 1 }}>
          {mine
            ? (mine === 'confirmed' ? 'Thanks.' : 'Noted - fill these in by hand if they are wrong.')
            : 'Not yet checked by a second person, so nothing fills in from it automatically. Does it match the datasheet?'}
        </span>
        {!mine && companion?.parts?.vote && (
          <>
            <button type="button" className="btn btn-sm btn-info" onClick={() => vote('confirmed')}>Yes, it matches</button>
            <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => vote('rejected')}>No</button>
            <button type="button" className="btn btn-sm btn-link p-0" onClick={() => vote('unsure')}>Not sure</button>
          </>
        )}
      </div>
      {error && <div className="small text-danger">{error}</div>}
    </div>
  );
}
