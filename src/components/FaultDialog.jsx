import { canFill, canReplace, currentOptions, fixPreset, fmt, ratingsOf } from '../typeFaults.js';

// What is wrong with a type, at a size you can read. This was a title="" tooltip,
// which meant the full sentence — the one that says whether the datasheet match
// might itself be wrong — appeared for as long as the mouse stayed still and
// could not be read at your own pace, let alone acted on.
//
// The remedies live here too. A warning you can only look at is a nag; the fix
// belongs next to the reason for it.
export default function FaultDialog({ t, spec, faults, onClose, onFix }) {
  const opts = currentOptions(t, spec);
  const fill = onFix && canFill(t, spec);
  const replace = onFix && canReplace(t, spec);

  return (
    <div className="nt-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="fd-dialog" role="dialog" aria-label="What to check">
        <div className="fd-head">
          <span className="fd-ref">{t.typeRef}</span>
          <span className="fd-name">{t.name || '—'}</span>
          <button className="btn btn-sm btn-link ms-auto p-0" onClick={onClose}>close</button>
        </div>

        <div className="fd-states">
          <span><b>{ratingsOf(t)}</b> in the DesignDB</span>
          {spec && <span className="text-secondary">{spec.name} spec page: {ratingsOf({
            maxPowerW: spec.maxPowerW,
            currentA: spec.powerType === 'CC' ? null : undefined,
            outputVoltageV: spec.outputV,
            nodeMaxFvV: spec.maxFvV,
          })}{spec.minA != null ? ` · ${spec.minA}–${spec.maxA}A` : ''}</span>}
        </div>

        <ul className="fd-list">
          {faults.map(([short, full]) => (
            <li key={short}>
              <b>{short}</b>
              <span>{full}</span>
            </li>
          ))}
        </ul>

        <div className="fd-foot">
          {fill && (
            <button className="btn btn-sm btn-outline-primary" onClick={() => onFix('fill')}>
              Fill blanks from {spec.name}
            </button>
          )}
          {replace && (
            <button className="btn btn-sm btn-outline-warning" onClick={() => onFix('replace')}>
              Use the spec page ({fmt(spec.maxPowerW)}W)
            </button>
          )}
          {/* ref and name disagree about the current — pick one; the Name is
              corrected to match and the Ref is left alone */}
          {onFix && opts.length > 1 && opts.map((o) => (
            <button key={o.from} className="btn btn-sm btn-outline-secondary"
              onClick={() => onFix('fill', o.a)}>
              Set CurrentRange to {o.a}A <em className="text-secondary">per the {o.from}</em>
            </button>
          ))}
          {!onFix && (
            <span className="text-secondary small">Correct it on the Driver types page.</span>
          )}
          <button className="btn btn-sm btn-link ms-auto" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
