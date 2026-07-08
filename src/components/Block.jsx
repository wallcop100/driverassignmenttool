import { useContext } from 'react';
import { LabelContext } from '../labelContext.js';
import { cgColor, labelText, severityOf } from '../state.js';
import Tooltip from './Tooltip.jsx';

export default function Block({ link, linkRef, flags = [], pending, selected, dispatch, draggable = true, groups }) {
  const labelFields = useContext(LabelContext);
  const ref = link?.ref ?? linkRef;
  const severity = severityOf(flags); // FAIL/MISMATCH (CC/CV + mA) both render as serious
  const fail = severity === 'FAIL';
  const mismatch = severity === 'MISMATCH';
  const warn = severity === 'WARN';
  const solid = fail || mismatch; // both get a solid fill — equally serious, not a subtle ring
  const cls = ['cable-block', fail && 'is-fail', !fail && mismatch && 'is-mismatch',
    !fail && !mismatch && warn && 'is-warn', pending && 'is-pending', selected && 'is-selected',
    !link && 'is-unknown'].filter(Boolean).join(' ');
  // proportional to load for the packing visual, but only a *minimum* so the
  // label/fV text is never clipped — the block grows to fit its content.
  const minWidth = link?.loadW ? Math.max(46, Math.min(link.loadW * 5, 220)) : 56;

  const color = link ? cgColor(link.controlGroup, groups) : cgColor(null, groups);
  const style = { minWidth };
  if (!solid) style.background = color.bg;
  const bandStyle = solid ? undefined : { background: color.border };

  const detailLines = link
    ? [`${ref}`,
       `${link.loadW ?? '?'}W · ${link.powerType ?? 'no type'}`,
       !link.powerType ? 'No SecondaryPowerType declared — check the Links CSV' : null,
       link.fvV != null ? `${link.fvV}fV` : null,
       link.currentA != null ? `${link.currentA}A` : null,
       `group ${link.controlGroup || '—'}`,
       [link.location, link.positionType].filter(Boolean).join(' · ') || null,
       [link.threadCount && `${link.threadCount} thread`, link.controlType].filter(Boolean).join(' · ') || null,
       ...flags.map((f) => f.message),
      ].filter(Boolean)
    : [`${ref} (no load data — not in Links CSV)`];

  return (
    <Tooltip content={detailLines}>
      <div className={cls} style={style} data-link={ref}
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
        {link && !link.powerType && <span className="block-badge badge-unknown-type">?</span>}
      </div>
    </Tooltip>
  );
}
