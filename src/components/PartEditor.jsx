import { useEffect, useRef, useState } from 'react';
import * as recipe from '../drivers/recipe.js';
import { dragTo } from '../core/snap.js';
import Origin from './Origin.jsx';
import ResizeIcon from './ResizeIcon.jsx';

// The parts inside one driver module: which part is which, how big, and where it
// sits. Opened from the pencil. A part's size and place belong to its wrapper
// TYPE, so the header says how many Elements an edit reaches, and a change that
// would reach more than one asks whether it is for this Element or for the type.

const ROLES = ['PSU', 'Driver', 'EM'];
const ICON = { w: 'fit_width', h: 'height' };

const SOURCE = {
  edited: 'arranged here, not in the DB yet',
  spaces: 'the type, as the DB states it',
  element: 'this Element, as the DB states it',
  children: 'the DB\'s child Elements, laid out by the house rule (the arrangement is not in the DB yet)',
  suggested: 'the datasheet pair the name suggests (not in the DB)',
};

export default function PartEditor({
  module, elementLabel, usedBy, typeNames, snap, jboxes, jbStored, jbAuto,
  onSave, onJboxes, onClose, children,
}) {
  const source = module.recipe.source;
  const fixed = source === 'children';
  const [parts, setParts] = useState(() => recipe.nameSpaces(module.recipe.parts
    .map((p) => ({ ...p, at: p.at ?? [0, 0, 0], size: p.size ?? [100, 50, 30] }))));
  const [act, setAct] = useState(null);
  const [dirty, setDirty] = useState(false);
  const actRef = useRef(null);
  actRef.current = act;

  // the type's envelope is its parts; the preview also shows this Element's
  // junction boxes, which sit beside them and are not the type's to state
  const env = recipe.envelope(parts) ?? [100, 50, 30];
  const jbs = recipe.jbSpaces(jboxes ?? 0, parts);
  const view = recipe.envelope([...parts, ...jbs]) ?? env;
  const k = Math.min(1.2, 300 / Math.max(view[0], 1), 190 / Math.max(view[1], 1));
  const PAD = 18;
  const W = view[0] * k + PAD * 2;
  const H = view[1] * k + PAD * 2;

  // one drag at a time: moving a part, or pulling one of its edges, on the snap
  useEffect(() => {
    if (!act) return undefined;
    const move = (e) => {
      const a = actRef.current;
      if (!a) return;
      const mods = { alt: e.altKey, shift: e.shiftKey };
      const dx = (e.clientX - a.x0) / k;
      const dy = (a.y0 - e.clientY) / k;
      setParts((ps) => ps.map((p, i) => {
        if (i !== a.i) return p;
        const s = a.start;
        if (a.mode === 'move') {
          return { ...p, at: [dragTo(s.at[0], dx, snap, mods), dragTo(s.at[1], dy, snap, mods), s.at[2] ?? 0] };
        }
        const w = a.mode === 'h' ? s.size[0] : dragTo(s.size[0], dx, snap, mods, { min: 5 });
        const h = a.mode === 'w' ? s.size[1] : dragTo(s.size[1], dy, snap, mods, { min: 5 });
        return { ...p, size: [w, h, s.size[2] ?? 0], sizeOrigin: 'edited' };
      }));
    };
    const up = () => { setAct(null); setDirty(true); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [act?.i, act?.mode]);

  const start = (e, i, mode) => {
    e.preventDefault();
    e.stopPropagation();
    setAct({ i, mode, x0: e.clientX, y0: e.clientY, start: parts[i] });
  };
  const set = (i, patch) => { setParts((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p))); setDirty(true); };
  const setNum = (i, key, axis, v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    const next = [...(parts[i][key] ?? [0, 0, 0])];
    next[axis] = n;
    set(i, key === 'size' ? { size: next, sizeOrigin: 'edited' } : { at: next });
  };
  const save = (scope) => { onSave(parts, scope); setDirty(false); };

  const handle = (i, mode, cx, cy) => (
    <g key={mode} className="pe-handle" transform={`translate(${cx},${cy})`}
      onPointerDown={(e) => start(e, i, mode)}>
      <title>{mode === 'w' ? 'Width' : mode === 'h' ? 'Height' : 'Width and height'}</title>
      <circle r="8" />
      <ResizeIcon name={ICON[mode]} size={11} x={-5.5} y={-5.5} />
    </g>
  );

  const asking = dirty && usedBy > 1;

  return (
    <div className="hub-inspect pe">
      <div className="hub-inspect-head">
        <b>Editing <span className="rv-ref">{module.typeRef}</span>, used by {usedBy} Element{usedBy === 1 ? '' : 's'}</b>
        <Origin kind={source === 'spaces' || source === 'element' ? null : source === 'edited' ? 'edited' : 'datasheet'}
          what="This arrangement" />
        <button type="button" className="btn-close ms-auto" aria-label="Close" onClick={onClose} />
      </div>
      <div className="text-secondary small">
        Parts from {SOURCE[source]}.
        {fixed && ' The recipe decides which parts there are; their size and place are yours.'}
      </div>

      <svg className="pe-preview" width={W} height={H}>
        <rect className="pe-envelope" x={PAD} y={H - PAD - env[1] * k} width={env[0] * k} height={env[1] * k} />
        {parts.map((p, i) => {
          const x = PAD + p.at[0] * k;
          const y = H - PAD - (p.at[1] + p.size[1]) * k;
          const w = p.size[0] * k;
          const h = p.size[1] * k;
          return (
            <g key={i} className={`pe-part ${act?.i === i ? 'is-active' : ''}`}>
              <rect className={`pe-rect is-${p.sizeOrigin ?? 'db'}`} x={x} y={y} width={w} height={h}
                rx={p.role === 'Driver' ? 3 : 0} onPointerDown={(e) => start(e, i, 'move')} />
              <text className="pe-label" x={x + w / 2} y={y + h / 2 + 4} textAnchor="middle">{p.space}</text>
              {handle(i, 'w', x + w, y + h / 2)}
              {handle(i, 'h', x + w / 2, y)}
            </g>
          );
        })}
        {jbs.map((sp) => {
          const x = PAD + sp.at[0] * k;
          const y = H - PAD - (sp.at[1] + sp.size[1]) * k;
          return (
            <g key={sp.name} className="pe-jb">
              <rect x={x} y={y} width={sp.size[0] * k} height={sp.size[1] * k} />
              <text x={x + (sp.size[0] * k) / 2} y={y + (sp.size[1] * k) / 2 + 4} textAnchor="middle">JB</text>
              <title>{`Junction box allowance on ${elementLabel}${jbStored ? '' : ' (the default, not in the DB)'}`}</title>
            </g>
          );
        })}
      </svg>

      <div className="pe-scroll">
        <table className="pe-table">
          <thead>
            <tr><th>space</th><th>role</th><th>type</th><th>w</th><th>h</th><th>d</th><th>x</th><th>y</th><th>size from</th><th /></tr>
          </thead>
          <tbody>
            {parts.map((p, i) => (
              <tr key={i}>
                <td><input value={p.space ?? ''} onChange={(e) => set(i, { space: e.target.value })} style={{ width: 72 }} /></td>
                <td>
                  <select value={p.role ?? ''} onChange={(e) => set(i, { role: e.target.value || null })}>
                    <option value="">part</option>
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td>
                  {fixed
                    ? <span className="rv-ref">{p.typeRef}</span>
                    : <input list="pe-types" value={p.typeRef ?? ''} placeholder="child type"
                      onChange={(e) => set(i, { typeRef: e.target.value.trim() || null })} style={{ width: 138 }} />}
                </td>
                {[['size', 0], ['size', 1], ['size', 2], ['at', 0], ['at', 1]].map(([key, axis]) => (
                  <td key={`${key}${axis}`}>
                    <input type="number" step={snap} value={p[key]?.[axis] ?? 0}
                      onChange={(e) => setNum(i, key, axis, e.target.value)} style={{ width: 58 }} />
                  </td>
                ))}
                <td><Origin kind={p.sizeOrigin === 'db' ? null : p.sizeOrigin ?? 'edited'} what={`${p.space}'s size`} /></td>
                <td>
                  {!fixed && (
                    <button type="button" className="btn btn-sm btn-link p-0" title="Remove this part"
                      onClick={() => { setParts((ps) => ps.filter((_, j) => j !== i)); setDirty(true); }}>
                      <span className="material-icons small-icon">close</span>
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <datalist id="pe-types">{typeNames.map((t) => <option key={t} value={t} />)}</datalist>
      </div>

      <div className="pe-foot">
        <span className="hub-bays">
          junction boxes on {elementLabel}
          <button type="button" className={jbStored ? '' : 'is-on'} onClick={() => onJboxes(null)}
            title="One per output on CV, none on CC">auto {jbAuto}</button>
          {[0, 1, 2, 3, 4].map((n) => (
            <button type="button" key={n} className={jbStored && jboxes === n ? 'is-on' : ''} onClick={() => onJboxes(n)}>{n}</button>
          ))}
        </span>
        <span className="text-secondary">envelope {env[0]} × {env[1]} × {env[2]}mm</span>
        <span className="ms-auto d-flex align-items-center gap-2">
          {!fixed && (
            <button type="button" className="btn btn-sm btn-link" onClick={() => {
              setParts((ps) => recipe.nameSpaces([...ps, { role: null, typeRef: null, size: [100, 50, 30], at: [0, env[1] + 5, 0], sizeOrigin: 'edited' }]));
              setDirty(true);
            }}>+ part</button>
          )}
          <button type="button" className="btn btn-sm btn-outline-secondary"
            onClick={() => { setParts((ps) => recipe.houseArrange(ps)); setDirty(true); }}>Reset to house rule</button>
          {asking ? (
            <span className="pe-ask">
              Apply to
              <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => save('element')}>This Element</button>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => save('type')}>The type ({usedBy})</button>
            </span>
          ) : (
            <button type="button" className="btn btn-sm btn-primary"
              disabled={!dirty && source !== 'children' && source !== 'suggested'} onClick={() => save('type')}>
              {source === 'suggested' ? 'Accept suggestion' : 'Save'}
            </button>
          )}
        </span>
      </div>
      {children}
    </div>
  );
}
