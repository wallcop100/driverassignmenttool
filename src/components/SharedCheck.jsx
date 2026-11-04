import { useState } from 'react';
import { checkOf, setSharedParts } from '../engine.js';
import { PARTS, conflicts, partRows } from '../catalogue.js';
import { useCompanion } from '../companion.js';
import { remember, said } from '../learn.js';

// A shared part one person has vouched for, asked of the next person to use it -
// PS&R's way (certainty.js), in PS&R's companion card (ConfirmSuggestionModal):
// sending a part is the sender's yes, a second person's yes makes it agreed, and
// two people saying no more often than yes takes it out of the catalogue. Only
// the button pressed is sent, for the version shown: an amended part is a new
// claim and is asked about again. A family's yes in the wizard is the same vote
// (learn.js), so whichever comes first counts and this card then thanks you.

export default function SharedCheck({ part }) {
  const companion = useCompanion();
  const [answered, setAnswered] = useState(null);
  const [error, setError] = useState(null);
  if (checkOf(part) !== 'unchecked' || !part.rev) return null;
  const mine = answered ?? said()[part.rev];
  const v = part.votes ?? {};
  const off = conflicts(part);
  const wrong = Object.keys(off).length > 0;
  // the datasheet it amends beside it, and the DesignDB's own values below: plain whose numbers are asked about
  const base = PARTS.find((b) => b.name === part.name);
  const was = base ? Object.fromEntries(partRows(base)) : {};

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
        {base
          ? `Another project changed the ${part.name}'s datasheet ratings. Are their changes right?`
          : `Another project entered the ${part.name}, which no datasheet here has. Are their ratings right?`}
      </div>
      <div className="sc-sub">
        This asks about the numbers they sent, not this DesignDB's: your answer changes nothing in the fields below.
      </div>
      <table className="table table-sm mb-1">
        <thead><tr><th /><th>Sent by another project</th>{base && <th>On the datasheet</th>}</tr></thead>
        <tbody>
          {v.no ? <tr><th>Others</th><td colSpan={base ? 2 : 1}>{v.no} said it is wrong</td></tr> : null}
          {partRows(part).map(([k, val]) => <tr key={k} className={off[k] ? 'is-off' : undefined}>
            <th>{k}</th><td>{val}</td>{base && <td>{was[k] ?? '-'}</td>}
          </tr>)}
        </tbody>
      </table>
      <div className="sc-foot">
        <span className="text-muted" style={{ flex: 1 }}>
          {mine
            ? (mine === 'confirmed' ? 'Thanks.' : 'Noted. Nothing here changes.')
            : wrong
              ? `Theirs differ from the datasheet on ${Object.keys(off).join(', ')}. Check the datasheet: a second yes puts their numbers in front of other projects.`
              : 'Check them against the datasheet: a second yes puts their numbers in front of other projects.'}
        </span>
        {!mine && companion?.parts?.vote && (
          <>
            <button type="button" className={`btn btn-sm ${wrong ? 'btn-outline-primary' : 'btn-info'}`} onClick={() => vote('confirmed')}>Yes, theirs are right</button>
            <button type="button" className={`btn btn-sm ${wrong ? 'btn-info' : 'btn-outline-primary'}`} onClick={() => vote('rejected')}>No, theirs are wrong</button>
            <button type="button" className="btn btn-sm btn-link p-0" onClick={() => vote('unsure')}>Not sure</button>
          </>
        )}
      </div>
      {error && <div className="small text-danger">{error}</div>}
    </div>
  );
}
