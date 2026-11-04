import { useState } from 'react';
import { canFill, canReplace, currentOptions, fixPreset, fmt, ratingsOf } from '../typeFaults.js';

// What is wrong with a type, at a size you can read. This was a title="" tooltip,
// which meant the full sentence - the one that says whether the datasheet match
// might itself be wrong - appeared for as long as the mouse stayed still and
// could not be read at your own pace, let alone acted on.
//
// The remedies live here too. A warning you can only look at is a nag; the fix
// belongs next to the reason for it.
export default function FaultDialog({ t, spec, faults, onClose, onFix, onAsk }) {
  const opts = currentOptions(t, spec);
  const fill = onFix && canFill(t, spec);
  const replace = onFix && canReplace(t, spec);
  // The one blank a spec page cannot fill: which current a CC driver is set to,
  // when neither the Ref nor the Name says. Asked here, so a fix fills it (KWNT6U).
  const [ma, setMa] = useState('');
  const askCurrent = onFix && spec?.powerType === 'CC' && t.currentA == null && !opts.length;
  const a = Number(ma) > 0 ? Number(ma) / 1000 : undefined;
  // anything else left blank - no match, or a DC/DC driver with no supply - is the wizard's to ask
  const blanks = faults.some((f) => f[2] !== 'disagrees');
  // A fix that leaves another fault keeps the dialog open; without this it looked
  // as if the button did nothing (9GYN2L).
  const [fixed, setFixed] = useState(false);
  const fix = (mode, a) => { onFix(mode, a); setFixed(true); };

  return (
    <div className="nt-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="fd-dialog" role="dialog" aria-label="What to check">
        <div className="fd-head">
          <span className="fd-ref">{t.typeRef}</span>
          <span className="fd-name">{t.name || '-'}</span>
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

        {fixed && (
          <div className="fd-fixed">
            <span className="material-icons" aria-hidden="true">check</span>
            Filled from the {spec?.name} spec page. {faults.length === 1 ? 'This is' : 'These are'} still left:
          </div>
        )}

        <ul className="fd-list">
          {faults.map(([short, full]) => (
            <li key={short}>
              <b>{short}</b>
              <span>{full}</span>
            </li>
          ))}
        </ul>

        {askCurrent && (
          <label className="fld sw-part">
            <span className="fld-col">Driven at what current?</span>
            <span className="fld-box">
              <input type="number" min="0" step="10" style={{ width: 90 }}
                placeholder={spec.minA != null ? `${spec.minA * 1000}–${spec.maxA * 1000}` : 'mA'}
                value={ma} onChange={(e) => setMa(e.target.value)} />
              mA
            </span>
            <span className="fld-ds">neither the Ref nor the Name says</span>
          </label>
        )}

        <div className="fd-foot">
          {fill && (
            <button className="btn btn-sm btn-outline-primary" onClick={() => fix('fill', a)}>
              Fill blanks from {spec.name}
            </button>
          )}
          {replace && (
            <button className="btn btn-sm btn-outline-warning" onClick={() => fix('replace', a)}>
              Use the spec page ({fmt(spec.maxPowerW)}W)
            </button>
          )}
          {/* ref and name disagree about the current - pick one; the Name is
              corrected to match and the Ref is left alone */}
          {onFix && opts.length > 1 && opts.map((o) => (
            <button key={o.from} className="btn btn-sm btn-outline-secondary"
              onClick={() => fix('fill', o.a)}>
              Set CurrentRange to {o.a}A <em className="text-secondary">per the {o.from}</em>
            </button>
          ))}
          {onAsk && blanks && !askCurrent && (
            <button className="btn btn-sm btn-outline-secondary" onClick={onAsk}>
              Answer the questions
            </button>
          )}
          {!onFix && (
            <span className="text-secondary small">Correct it on the Driver types page.</span>
          )}
          <button className="btn btn-sm btn-link ms-auto" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
