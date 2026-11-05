import { useState } from 'react';
import { canFill, canReplace, currentOptions, fmt, leaves, ratingsOf } from '../typeFaults.js';

// What is wrong with a type, at a size you can read. This was a title="" tooltip,
// which meant the full sentence - the one that says whether the datasheet match
// might itself be wrong - appeared for as long as the mouse stayed still and
// could not be read at your own pace, let alone acted on.
//
// The remedies live here too. A warning you can only look at is a nag; the fix
// belongs next to the reason for it.
export default function FaultDialog({ t, spec, faults, onClose, onFix, onAsk }) {
  const opts = currentOptions(t, spec);
  // The one thing a spec page cannot say: which current a CC driver is set to,
  // when neither the Ref nor the Name says (KWNT6U), or they disagree. Asked
  // first, because a fix without it would leave the card flagged (9GYN2L).
  const askCurrent = onFix && spec?.powerType === 'CC'
    && (opts.length > 1 || (t.currentA == null && !opts.length));
  const [ma, setMa] = useState('');
  const [picked, setPicked] = useState(null);
  const typed = Number(ma) > 0 ? Number(ma) / 1000 : null;
  const inRange = (x) => x != null && (spec?.minA == null || (x >= spec.minA && x <= spec.maxA));
  const a = !askCurrent ? undefined : opts.length > 1 ? picked : inRange(typed) ? typed : null;
  // Only a fix that leaves the card clean is offered; one that needs the current
  // waits for it. Judged at a current in range when none is given yet.
  const trial = a ?? opts[0]?.a ?? spec?.minA ?? undefined;
  const completes = (mode) => !leaves(t, spec, mode, askCurrent ? trial : a).length;
  const fill = onFix && (canFill(t, spec) || opts.length > 1) && completes('fill');
  const replace = onFix && canReplace(t, spec) && completes('replace');
  const ready = !askCurrent || a != null;
  // a fix the spec page can't finish is withheld, and says what it would leave
  const short = !fill && !replace && onFix && (canFill(t, spec) || canReplace(t, spec))
    && leaves(t, spec, canFill(t, spec) ? 'fill' : 'replace', trial)[0]?.[0];
  // a blank no fix can settle - no match, or a DC/DC driver with no supply - is the wizard's to ask
  const blanks = faults.some((f) => f[2] !== 'disagrees');

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

        <ul className="fd-list">
          {faults.map(([short, full]) => (
            <li key={short}>
              <b>{short}</b>
              <span>{full}</span>
            </li>
          ))}
        </ul>

        {askCurrent && (fill || replace) && (
          <div className="fld sw-part fd-current">
            <span className="fld-col">Driven at what current?</span>
            {opts.length > 1 ? (
              <span className="fd-picks" role="group" aria-label="Current">
                {opts.map((o) => (
                  <button key={o.from} type="button" aria-pressed={picked === o.a}
                    className={`btn btn-sm ${picked === o.a ? 'btn-primary' : 'btn-outline-primary'}`}
                    onClick={() => setPicked(o.a)}>
                    {o.a}A <small>per the {o.from}</small>
                  </button>
                ))}
              </span>
            ) : (
              <span className="fld-box">
                <input type="number" min="0" step="10" style={{ width: 120 }} aria-label="Current in mA" autoFocus
                  placeholder={spec.minA != null ? `${spec.minA * 1000}–${spec.maxA * 1000}` : 'mA'}
                  value={ma} onChange={(e) => setMa(e.target.value)} />
                mA
              </span>
            )}
            <span className="fd-hint">
              {opts.length > 1 ? 'the Ref and the Name disagree; the Name is corrected to match'
                : typed != null && !inRange(typed) ? `outside the ${spec.minA * 1000}–${spec.maxA * 1000}mA the spec page gives`
                  : 'neither the Ref nor the Name says'}
            </span>
          </div>
        )}

        {short && (
          <div className="fd-note">
            The {spec.name} spec page can't settle this on its own: it would still leave <b>{short}</b>.
            The questions ask for what it needs.
          </div>
        )}

        <div className="fd-foot">
          {fill && (
            <button className="btn btn-sm btn-outline-primary" disabled={!ready} onClick={() => onFix('fill', a)}>
              {canFill(t, spec) ? `Fill blanks from ${spec.name}` : `Set CurrentRange to ${a ?? '…'}A`}
            </button>
          )}
          {replace && (
            <button className="btn btn-sm btn-outline-warning" disabled={!ready} onClick={() => onFix('replace', a)}>
              Use the spec page ({fmt(spec.maxPowerW)}W)
            </button>
          )}
          {onAsk && blanks && !fill && !replace && (
            <button className="btn btn-sm btn-outline-primary" onClick={onAsk}>
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
