import Tooltip from './Tooltip.jsx';

// Where a value came from. The DesignDB is the normal case and carries no mark;
// everything else is the tool standing in for data the DB does not have yet,
// and says so. `what` names the thing in the tooltip.
const LABEL = { datasheet: 'datasheet', shared: 'suggested', edited: 'edited', missing: 'no size', tbc: 'TBC' };
const TELL = {
  datasheet: (w) => `${w} is not in the DB. The tool filled it from the datasheet so work can carry on; the patch writes it unless you drop it.`,
  shared: (w) => `${w} is not in the DB, and not from a spec page: the tool filled it from a part someone using this tool suggested. The patch writes it unless you drop it.`,
  edited: (w) => `${w} was changed here and is not in the DB yet. The patch writes it.`,
  missing: (w) => `${w} has no size in the DB or on its datasheet. Give it one to draw it to scale.`,
  tbc: (w) => `${w} is marked to be confirmed.`,
};

export default function Origin({ kind, what = 'This' }) {
  if (!kind || !LABEL[kind]) return null;
  return (
    <Tooltip content={TELL[kind](what)}>
      <span className={`origin-chip is-${kind}`}>{LABEL[kind]}</span>
    </Tooltip>
  );
}
