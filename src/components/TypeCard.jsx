import { ratingsOf, zoneList } from '../typeFaults.js';

// One driver ElementType, as a card. The same card on both surfaces: the picker
// adds it to a hub, the types page edits it. What a type IS does not change with
// what you came to do with it, so only the actions differ.
//
// A type worth a look is marked, not painted: a yellow fill reads as a
// highlighter through the numbers underneath, and the numbers are the point. The
// mark is a rail and a button, and the button opens the whole explanation rather
// than hiding it in a hover tooltip nobody can read at their own pace.
export default function TypeCard({ t, faults, usage, onWarn, children, below, className = '' }) {
  return (
    <div className={`tp-card ${faults.length ? 'is-off' : ''} ${className}`}>
      <div className="tp-card-top">
        <span className="tp-ref">{t.typeRef}</span>
        {t.preset && <span className="tp-dot" title="Changed here, not patched yet">pending</span>}
      </div>
      <div className="tp-line">
        <span className={`type-power ${t.powerType ? `is-${t.powerType.toLowerCase()}` : 'is-unknown'}`}>
          {t.powerType ?? '—'}
        </span>
        <span className="tp-name" title={t.name || ''}>{t.name || '—'}</span>
      </div>
      <div className="tp-spec">
        {ratingsOf(t)}
        <span className="tp-ch">
          {` · ${t.nodes?.length ?? 1} out`}{t.ballast ? ` · ${t.ballast}CH` : ''}
        </span>
      </div>
      <div className="tp-foot">
        <span className="tp-use" title={usage ? [...usage.zones].sort().join(', ') : ''}>
          {usage ? `${usage.count} × ${zoneList(usage.zones)}` : 'unused'}
        </span>
        {faults.length > 0 && (
          <button type="button" className="tp-warn" onClick={onWarn}>
            <span className="material-icons">warning_amber</span>
            {faults.length > 1 ? `${faults.length} to check` : 'check this'}
          </button>
        )}
        {children}
      </div>
      {below}
    </div>
  );
}
