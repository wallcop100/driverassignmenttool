import { useLayoutEffect, useRef, useState } from 'react';
import { fmt, fromShared, judge } from '../typeFaults.js';
import { REASONS, reasonsFor } from '../learn.js';
import Disputes from './Disputes.jsx';
import Tooltip from './Tooltip.jsx';

// One product family per step: the product on the left, a curve to every type
// that looks like it, and on each type exactly what accepting it writes.

const val = (v, unit) => `${fmt(v) ?? v}${unit ? ` ${unit}` : ''}`;
const isEm = (ref) => /(^|-)EM(-|$)/i.test(ref);
export const Pill = ({ t }) => <span className="est-pill est-pill-type">{t.typeRef}</span>;

const specRows = (s) => [
  ['Type', [s.powerType, s.controlType].filter(Boolean).join(' · ')],
  ['Outputs', s.outputs],
  ['Voltage', s.powerType === 'CV' && s.outputV != null && `${fmt(s.outputV)} V`],
  ['Max power', s.maxPowerW != null && `${fmt(s.maxPowerW)} W`],
  ['Per output', s.nodeMaxLoadW != null && `${fmt(s.nodeMaxLoadW)} W`],
  ['Forward voltage', s.maxFvV != null && `up to ${fmt(s.maxFvV)} V`],
  ['Current', s.minA != null && `${Math.round(s.minA * 1000)}–${Math.round(s.maxA * 1000)} mA`],
].filter(([, v]) => v != null && v !== false && v !== '');

// A fill the whole family shares is the product's own value, already on the left,
// so a card lists only what sets it apart. Current and voltage lead the card.
function What({ x, spec, shared }) {
  const j = judge(x.t, x.preset, spec);
  const fills = j.filter((e) => e.status === 'fill' && !shared.has(e.key) && e.key !== 'currentA' && e.key !== 'outputVoltageV');
  const chip = (key, cls, label, tip) => {
    const c = <span key={key} className={`est-pill ty-chip ${cls}`} tabIndex={tip ? 0 : undefined}>{label}</span>;
    return tip ? <Tooltip key={key} content={tip}>{c}</Tooltip> : c;
  };
  return (
    <div className="ty-what">
      {x.note && chip('note', 'is-guess', 'a guess', x.note)}
      {j.filter((e) => e.status !== 'fill').map((e) => chip(e.key, e.status === 'wrong' ? 'is-wrong' : 'is-differ',
        <>{e.col} <s>{val(e.was, e.unit)}</s> → {val(e.now, e.unit)}</>, e.hint))}
      {fills.map((e) => chip(e.key, 'is-fill', `+ ${e.col} ${val(e.now, e.unit)}`))}
    </div>
  );
}

export function FamilyStep({ f, out, toggle, rows = [], picks = {}, onPick }) {
  const map = useRef(null);
  const [wires, setWires] = useState(null);

  // the bendy lines, redrawn whenever a card moves
  useLayoutEffect(() => {
    const el = map.current;
    const draw = () => {
      const m = el.getBoundingClientRect();
      const p = el.querySelector('.tr-prod').getBoundingClientRect();
      const x0 = p.right - m.left; const y0 = p.top + p.height / 2 - m.top;
      setWires({
        x0, y0,
        paths: [...el.querySelectorAll('.ty')].map((c) => {
          const r = c.getBoundingClientRect();
          const x1 = r.left - m.left; const y1 = r.top + 22 - m.top; const dx = (x1 - x0) * 0.55;
          return { x1, y1, d: `M${x0},${y0} C${x0 + dx},${y0} ${x1 - dx},${y1} ${x1},${y1}`, out: c.classList.contains('is-out') };
        }),
      });
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [f, out]);

  const shared = new Set(Object.keys(f.types[0].preset)
    .filter((k) => f.types.every((x) => String(x.preset[k]) === String(f.types[0].preset[k]))));

  const n = f.types.length;
  return (
    <>
      <div className="tr-q">
        <h2>{n === 1 ? `Is this a ${f.part.name}?` : `Are these ${n} a ${f.part.name}?`}</h2>
        <p>
          {n === 1 ? 'Its' : 'Their'} Name and Ref say so. {fromShared(f.spec)
            ? 'Its blanks are filled in, and what the DesignDB already says is kept.'
            : "Blanks are filled in, and where a value doesn't match the datasheet, the datasheet's is used."}
          {' '}If one isn't right, set it aside and you'll look at it at the end.
        </p>
      </div>
      <div className="tr-body">
        <Disputes rows={rows} picks={picks} onPick={onPick} fills={n === 1 ? 'this type' : `these ${n} types`} />
        <div className="tr-map" ref={map}>
          <svg aria-hidden="true">
            {wires?.paths.map((w, i) => (
              <g key={i}>
                <path d={w.d} fill="none" stroke={w.out ? '#cbd5e1' : '#93b4ea'} strokeWidth="2" strokeDasharray={w.out ? '5 5' : undefined} />
                <circle cx={w.x1} cy={w.y1} r="3.5" fill={w.out ? '#cbd5e1' : '#2563eb'} />
              </g>
            ))}
            {wires && <circle cx={wires.x0} cy={wires.y0} r="4.5" fill="#2563eb" />}
          </svg>
          <div className="tr-prod">
            <div className="tr-prod-name">{f.part.name}</div>
            {f.supply && <div className="tr-prod-sub">on a {f.supply.name}</div>}
            <table className="tr-spec"><tbody>
              {specRows(f.spec).map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}
            </tbody></table>
          </div>
          <div className="tr-types">
            {f.types.map((x) => {
              const off = out.has(x.t.typeRef);
              return (
                <div key={x.t.typeRef} className={`ty ${off ? 'is-out' : ''}`}>
                  <div className="ty-diff">
                    {x.currentA != null ? `${Math.round(x.currentA * 1000)} mA` : f.spec.outputV != null ? `${fmt(f.spec.outputV)} V` : ''}
                    {isEm(x.t.typeRef) && <small>EMERGENCY</small>}
                  </div>
                  <div className="ty-ref"><Pill t={x.t} /></div>
                  <div className="ty-name">{x.t.name || (off ? <i>no Name</i> : (
                    <span className="est-pill ty-chip is-name"><span className="material-icons">edit</span>{x.preset.name}</span>
                  ))}</div>
                  <div className="ty-act">
                    <button className={`btn ${off ? 'btn-link' : 'btn-outline-secondary'}`} onClick={() => toggle(x.t.typeRef)}>
                      {off ? 'Put back' : 'Not right'}
                    </button>
                  </div>
                  {off
                    ? <div className="ty-what"><span className="est-pill ty-chip">set aside, for the review</span></div>
                    : <What x={x} spec={f.spec} shared={shared} />}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}

// "Its own values are right", asked once more per value that differs: why. The
// answer is a code, never text, and it is what the companion learns (learn.js).
function Reasons({ x, onKeep, onCancel }) {
  const diffs = judge(x.t, x.preset, x.f.spec).filter((e) => e.status !== 'fill');
  const [ans, setAns] = useState({});
  return (
    <div className="rv-reasons">
      {diffs.map((e) => (
        <div key={e.key} className="rv-reason">
          <span className="rv-val"><b>{e.col}</b> {val(e.was, e.unit)} here, {val(e.now, e.unit)} on the datasheet</span>
          <span className="btns">
            {reasonsFor(e).map((r) => (
              <button key={r} type="button" aria-pressed={ans[e.key] === r}
                className={`btn btn-sm ${ans[e.key] === r ? 'btn-primary' : 'btn-outline-secondary'}`}
                onClick={() => setAns({ ...ans, [e.key]: r })}>{REASONS[r]}</button>
            ))}
          </span>
        </div>
      ))}
      <div className="btns">
        <button className="btn btn-sm btn-primary" disabled={diffs.some((e) => !ans[e.key])} onClick={() => onKeep(ans)}>
          Keep its own values
        </button>
        <button className="btn btn-sm btn-link" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// What was set aside, and what no product was found for. Each answer is one click.
export function Review({ aside, rest, presets, onAsk, onOther, onOwn, onBack }) {
  const [asking, setAsking] = useState(null);   // the set-aside type being asked why
  const filled = (types) => types.every((t) => presets[t.typeRef]);
  // with nothing differing there is nothing to ask: its blanks are filled and the rest kept
  const own = (x) => (judge(x.t, x.preset, x.f.spec).some((e) => e.status !== 'fill') ? setAsking(x.t.typeRef) : onOwn(x, {}));
  const card = (key, types, why, btns) => (
    <div key={key} className="rv">
      <div className="rv-h">
        {types.map((t) => <Pill key={t.typeRef} t={t} />)}
        <span className="ty-name">{types[0].name || <i>no Name</i>}</span>
        {filled(types) && <span className="tp-dot ms-auto">filled in</span>}
      </div>
      <div className="rv-why">{why}</div>
      <div className="btns">{btns}</div>
    </div>
  );
  const left = aside.length + rest.length;
  return (
    <>
      <div className="tr-q">
        <h2>{left ? `${left} left to look at` : 'Nothing left to look at'}</h2>
        <p>{left ? 'The ones you set aside, and the ones no product was found for.' : 'Every type here is one of the products above.'}</p>
      </div>
      <div className="tr-body">
        {aside.length > 0 && <div className="rv-sec">Set aside</div>}
        {aside.map((x) => card(x.t.typeRef, [x.t], asking === x.t.typeRef
          ? `Why is the DesignDB right? Each answer is kept with the ${x.f.part.name}.`
          : `You said this isn't right as a ${x.f.part.name}. What's wrong?`, asking === x.t.typeRef ? (
          <Reasons x={x} onKeep={(ans) => { setAsking(null); onOwn(x, ans); }} onCancel={() => setAsking(null)} />
        ) : (
          <>
            <button className="btn btn-sm btn-outline-primary" onClick={() => onOther(x)}>It's a different product</button>
            <button className="btn btn-sm btn-outline-secondary" onClick={() => own(x)}>It is a {x.f.part.name}, but its own values are right</button>
            <button className="btn btn-sm btn-link" onClick={() => onBack(x)}>Put it back with the {x.f.part.name}s</button>
          </>
        )))}
        {rest.length > 0 && <div className="rv-sec">No product found</div>}
        {rest.map((g) => card(g.types[0].typeRef, g.types, g.why, (
          <>
            <button className="btn btn-sm btn-outline-primary" onClick={() => onAsk({ types: g.types, fresh: !g.spec })}>
              Answer a few questions{g.types.length > 1 ? `, for all ${g.types.length}` : ''}
            </button>
            <button className="btn btn-sm btn-link" onClick={() => onAsk({ types: g.types, hand: true })}>Fill it in by hand</button>
          </>
        )))}
      </div>
    </>
  );
}
