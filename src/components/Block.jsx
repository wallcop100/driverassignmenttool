import { useContext } from 'react';
import { LabelContext } from '../labelContext.js';
import { cgColor, labelText } from '../state.js';

export default function Block({ link, linkRef, flags = [], pending, selected, dispatch, draggable = true }) {
  const labelFields = useContext(LabelContext);
  const ref = link?.ref ?? linkRef;
  const mismatch = flags.some((f) => f.level === 'MISMATCH');
  const fail = flags.some((f) => f.level === 'FAIL');
  const warn = flags.some((f) => f.level === 'WARN');
  const cls = ['cable-block', fail && 'is-fail', !fail && mismatch && 'is-mismatch',
    !fail && !mismatch && warn && 'is-warn', pending && 'is-pending', selected && 'is-selected',
    !link && 'is-unknown'].filter(Boolean).join(' ');
  // proportional to load for the packing visual, but only a *minimum* so the
  // label/fV text is never clipped — the block grows to fit its content.
  const minWidth = link?.loadW ? Math.max(46, Math.min(link.loadW * 5, 220)) : 56;

  const color = link ? cgColor(link.controlGroup) : cgColor(null);
  const style = { minWidth };
  if (!fail) style.background = color.bg;
  const bandStyle = fail ? undefined : { background: color.border };

  const detail = link
    ? [`${ref}`,
       `${link.loadW ?? '?'}W · ${link.powerType ?? 'no type'}`,
       link.fvV != null ? `${link.fvV}fV` : null,
       link.currentA != null ? `${link.currentA}A` : null,
       `group ${link.controlGroup || '—'}`,
       [link.location, link.positionType].filter(Boolean).join(' · ') || null,
       [link.threadCount && `${link.threadCount} thread`, link.controlType].filter(Boolean).join(' · ') || null,
       flags.length ? '—\n' + flags.map((f) => f.message).join('\n') : null,
      ].filter(Boolean).join('\n')
    : `${ref} (no load data — not in Links CSV)`;

  return (
    <div className={cls} style={style} title={detail}
      draggable={draggable && !!link}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', ref);
        dispatch({ type: 'SET_DRAGGING', linkRef: ref });
      }}
      onDragEnd={() => dispatch({ type: 'SET_DRAGGING', linkRef: null })}
      onClick={(e) => {
        e.stopPropagation();
        if (link) dispatch({ type: 'SELECT_LINKS', linkRef: ref, additive: e.ctrlKey || e.metaKey });
      }}>
      <span className="block-band" style={bandStyle}>
        {link && <span className="material-icons block-grip" title="drag to move">drag_indicator</span>}
      </span>
      <span className="block-label">
        {link ? labelText(link, labelFields) : ref}
      </span>
      {mismatch && <span className="material-icons block-badge badge-mismatch-icon">priority_high</span>}
      {link && !link.powerType && <span className="block-badge badge-unknown-type">?</span>}
    </div>
  );
}
