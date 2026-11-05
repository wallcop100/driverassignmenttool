import { fmt } from '../typeFaults.js';
import { pickKey } from '../learn.js';

// Another project said the datasheet was wrong on these values, and nobody has
// checked their correction yet. One row per value: the datasheet's, theirs, or
// not sure. The pick fills the types it is shown for and is the check (learn.js).
// It never asks about this DesignDB's own values: those are offered against the
// datasheet as usual.
const val = (v, unit) => `${typeof v === 'number' ? fmt(v) : v}${unit ? ` ${unit}` : ''}`;

export default function Disputes({ rows, picks, onPick, fills }) {
  if (!rows.length) return null;
  const pair = new Set(rows.map((r) => r.part)).size > 1;
  return (
    <div className="companion-card disputes" role="group" aria-label="Values another project corrected">
      <div className="dp-head">
        <span className="material-icons" aria-hidden="true">rate_review</span>
        {rows.length === 1 ? 'One value needs your eye' : `${rows.length} values need your eye`}
      </div>
      <div className="dp-sub">
        Another project overruled the {pair ? 'datasheets' : `${rows[0].part} datasheet`} here. Which is right? Your pick fills {fills}.
      </div>
      {rows.map((r) => {
        const k = pickKey(r);
        const btn = (v, label, sub, cls = 'btn-outline-primary') => (
          <button type="button" aria-pressed={picks[k] === v} onClick={() => onPick(r, v)}
            className={`btn btn-sm ${picks[k] === v ? 'btn-info' : cls}`}>
            {label}{sub && <small>{sub}</small>}
          </button>
        );
        return (
          <div key={k} className="dp-row">
            <span className="dp-col">{r.col}{pair && <small>{r.part}</small>}</span>
            {btn('datasheet', <b>{val(r.datasheet, r.unit)}</b>, 'datasheet')}
            {btn('theirs', <b>{val(r.theirs, r.unit)}</b>, 'their correction')}
            {btn('unsure', 'Not sure', "uses the datasheet's", 'btn-link')}
          </div>
        );
      })}
    </div>
  );
}
