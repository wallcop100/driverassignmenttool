import { useEffect, useMemo, useRef, useState } from 'react';
import { PARTS, resolveSpec } from '../engine.js';
import { effectiveDrivers } from '../state.js';
import * as hl from '../hubLayout.js';
import * as draw from '../core/draw.js';

// Composing one PSU hub, drawn the way 5642600A draws it: hatched cabinet walls,
// equipment as labelled blocks with the drivers rounded, Feed Provision hatched
// at the bottom, dimensions called out on the outside.
//
// A bay is a stack, so dragging reorders rather than positions: two blocks
// cannot overlap and the gap between neighbours is always exactly the clearance
// they carry. The millimetres fall out of the sequence.
//
// The unit is a module, not a rectangle — a PSU across the top, the driver
// bottom left, its junction boxes stacked bottom right — because that is what
// the drawings put in a bay.

const SCALE = 0.36;
const px = (n) => n * SCALE;
// The trunking band is the side clearance, not an extra wall: see hubLayout.

const JBOX = (n) => ({ kind: 'jbox', label: 'JUNCTION BOX', size: [80, 35, 40], ref: `jb${n}` });

// Lettering a block, the way the drawings letter it: it has to fit inside the
// box. Shrink to a floor, then trim — never run past the edge, which is what
// made every label overflow its rectangle.

// How many junction boxes a driver brings before anybody edits it. A constant
// voltage run is broken out at a box per output, so a 4-output CV driver arrives
// with 4. Constant current is a home run per output straight to the fitting, so
// it brings none.
export function defaultJboxes(spec, type) {
  const power = spec?.powerType ?? type?.powerType ?? null;
  if (power !== 'CV') return 0;
  return spec?.outputs ?? type?.nodes?.length ?? type?.outputs ?? 1;
}

// A driver, its supply and its junction boxes, as one module.
function moduleFor(driver, jboxes) {
  const spec = resolveSpec(driver.name || driver.typeName || driver.typeRef);
  const part = spec?.driver ?? spec ?? null;
  const supply = spec?.supply ?? null;
  const parts = [
    { kind: 'driver', label: part?.code ?? part?.name ?? driver.typeRef, size: part?.sizeMm ?? null,
      full: part?.name ?? driver.typeRef },
    ...(supply ? [{ kind: 'psu', label: supply.code ?? supply.name, size: supply.sizeMm ?? null,
      full: supply.name }] : []),
    ...Array.from({ length: jboxes ?? defaultJboxes(spec, driver) }, (_, n) => JBOX(n)),
  ];
  const built = composite(parts);
  return {
    ref: driver.ref,
    label: driver.typeRef,
    kind: 'module',
    jboxes: jboxes ?? defaultJboxes(spec, driver),
    missing: parts.filter((p) => !p.size).map((p) => p.full ?? p.label),
    size: built?.size ?? null,
    parts: built?.parts ?? [],
  };
}
const composite = (parts) => (parts.some((p) => p.kind === 'driver' && p.size)
  ? hl.composite(parts.filter((p) => p.size)) : null);

export default function HubLayoutLab({ state, zone = null, onBack = null }) {
  const { model, addedDrivers } = state;
  const drivers = useMemo(
    () => effectiveDrivers(model, addedDrivers, state.deletedDrivers),
    [model, addedDrivers, state.deletedDrivers],
  );
  const hubs = model.zones;
  // opened from a hub's page, start on that hub
  const [hub, setHub] = useState(hubs.includes(zone) ? zone : hubs[0] ?? null);
  const [st, setSt] = useState({});
  const [sel, setSel] = useState([]);
  const [drag, setDrag] = useState(null);
  const [sizes, setSizes] = useState({});     // label -> [w,h] typed in here
  const [hist, setHist] = useState({ undo: [], redo: [] });
  const [bounds, setBounds] = useState(false);   // the purple clearance envelope
  const bayEls = useRef({});

  const cur = st[hub] ?? null;

  useEffect(() => {
    if (!hub || st[hub]) return;
    const items = drivers.filter((d) => d.zone === hub).map((d) => moduleFor(d, null));
    setSt((s) => ({ ...s, [hub]: { bays: [items], width: null, target: { w: '', h: '' }, feed: true, separate: [] } }));
  }, [hub, drivers, st]);

  const edit = (next) => {
    setHist((h) => ({ undo: [...h.undo, cur], redo: [] }));
    setSt((s) => ({ ...s, [hub]: { ...cur, ...next } }));
  };
  const undo = () => setHist((h) => {
    if (!h.undo.length) return h;
    setSt((s) => ({ ...s, [hub]: h.undo[h.undo.length - 1] }));
    return { undo: h.undo.slice(0, -1), redo: [...h.redo, cur] };
  });
  const redo = () => setHist((h) => {
    if (!h.redo.length) return h;
    setSt((s) => ({ ...s, [hub]: h.redo[h.redo.length - 1] }));
    return { undo: [...h.undo, cur], redo: h.redo.slice(0, -1) };
  });

  if (!cur) return <div className="container py-4 text-secondary">No hubs in this data.</div>;

  // apply any sizes typed in, then rebuild the modules that depend on them
  const applySizes = (items) => items.map((i) => {
    const d = drivers.find((x) => x.ref === i.ref);
    if (!d) return i;
    const m = moduleFor(d, i.jboxes);
    const patched = m.parts.length ? m : i;
    return { ...patched, jboxes: i.jboxes };
  });

  const bayOuter = cur.width != null ? cur.width / Math.max(1, cur.bays.length) : hl.BAY_WIDTH;
  const inner = bayOuter - hl.TRUNK * 2;
  const withFeed = (items, b) => (cur.feed && b === cur.bays.length - 1
    ? [hl.feedItem(inner, 105), ...items] : items);
  const drawn = cur.bays.map(withFeed);
  // joined bays share their centre, so the hub is narrower than bays x width
  const joinedCount = cur.bays.length - cur.separate.length;
  const ext = hl.extent(drawn, {
    slotWidth: bayOuter, width: cur.width,
    joined: joinedCount > 1,
  });
  const fit = hl.fitsIn(ext, cur.target);
  const missing = [...new Set(cur.bays.flat().flatMap((i) => i.missing ?? []))];

  const toggle = (ref, add) => setSel((c) => (add
    ? (c.includes(ref) ? c.filter((r) => r !== ref) : [...c, ref])
    : (c.includes(ref) && c.length === 1 ? [] : [ref])));

  const boardY = (b, clientY) => {
    const el = bayEls.current[b];
    if (!el) return 0;
    return (el.getBoundingClientRect().bottom - clientY) / SCALE;
  };

  const onDrop = () => {
    if (drag?.overBay != null) edit({ bays: hl.moveItem(cur.bays, drag.ref, drag.overBay, drag.atIndex) });
    setDrag(null);
  };

  const setJboxes = (n) => edit({
    bays: cur.bays.map((b) => b.map((i) => {
      if (!sel.includes(i.ref)) return i;
      const d = drivers.find((x) => x.ref === i.ref);
      return d ? moduleFor(d, n) : i;
    })),
  });

  return (
    <div className="container-fluid py-3 hub-lab" onMouseUp={onDrop} onMouseLeave={() => setDrag(null)}>
      <div className="dp-head">
        {onBack && (
          <button className="btn btn-sm btn-outline-secondary d-flex align-items-center"
            onClick={onBack} title="Back to assigning this hub">
            <span className="material-icons small-icon">arrow_back</span> Assign
          </button>
        )}
        <select className="form-select form-select-sm" style={{ width: 'auto' }} value={hub}
          onChange={(e) => { setHub(e.target.value); setSel([]); setHist({ undo: [], redo: [] }); }}>
          {hubs.map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
        <h5 className="mb-0 hub-dim">{ext.w} × {ext.h} × {hl.DEPTH_MM}mm</h5>
        {(cur.target.w || cur.target.h) && (
          <span className={`hub-verdict ${fit.fits ? 'is-ok' : 'is-over'}`}>
            {fit.fits ? 'fits' : `${Math.max(fit.overW ?? 0, fit.overH ?? 0)}mm over`}
          </span>
        )}
        <span className="ms-auto d-flex align-items-center gap-2">
          <button className="btn btn-sm btn-outline-secondary" disabled={!hist.undo.length} onClick={undo}
            title="Undo"><span className="material-icons small-icon align-middle">undo</span></button>
          <button className="btn btn-sm btn-outline-secondary" disabled={!hist.redo.length} onClick={redo}
            title="Redo"><span className="material-icons small-icon align-middle">redo</span></button>
          <span className="badge text-bg-warning">lab</span>
        </span>
      </div>

      {missing.length > 0 && (
        <div className="dp-suggest sw-offer">
          <div>
            <b>{missing.length} part{missing.length === 1 ? ' has' : 's have'} no size</b>
            <div className="text-secondary small">Their spec page gives dimensions in a drawing, not in text.</div>
          </div>
          <div className="hub-sizes ms-auto">
            {missing.map((label) => (
              <label key={label} className="fld">
                <span className="fld-col">{label}</span>
                <span className="fld-box">
                  <input type="number" style={{ width: 58 }} placeholder="w"
                    onChange={(e) => setSizes({ ...sizes, [label]: [+e.target.value, sizes[label]?.[1]] })} />
                  <input type="number" style={{ width: 58 }} placeholder="h"
                    onChange={(e) => setSizes({ ...sizes, [label]: [sizes[label]?.[0], +e.target.value] })} />
                </span>
              </label>
            ))}
            <button className="btn btn-sm btn-primary" onClick={() => {
              for (const [label, wh] of Object.entries(sizes)) {
                const part = PARTS.find((p) => p.name === label);
                if (part && wh[0] > 0 && wh[1] > 0) part.sizeMm = [wh[0], wh[1], hl.DEPTH_MM];
              }
              edit({ bays: cur.bays.map(applySizes) });
            }}>Use these</button>
          </div>
        </div>
      )}

      <div className="hub-sheets">
        {hl.sheets(cur.bays.length, cur.separate).map((sheet, si) => {
          // Joined bays are one cabinet with a divider, not two boxes side by
          // side: they share the gap between them, so the centre is 50 and not
          // the 100 they would make bringing 50 each.
          const bays = sheet.slots.map((b) => withFeed(cur.bays[b], b));
          const pitch = hl.pitchOf(bayOuter, true);
          const sheetExt = hl.extent(bays, { slotWidth: bayOuter, joined: true });
          const H = px(Math.max(sheetExt.h, 150));
          const W = px(sheetExt.w);
          const placed = hl.placements(bays, { slotWidth: bayOuter, joined: true });
          // the trunking is a property of a ROW, not of a part: one band down
          // each side of an upright run, one across the ends of a turned one
          const rows = bays.flatMap((items, local) =>
            hl.packBay(items, bayOuter).map((r) => ({ ...r, x0: local * hl.pitchOf(bayOuter, true) })));
          return (
            <div key={si} className="hub-sheet">
              <div className="hub-sheet-head">
                <b>{hub}{sheet.separate ? `-${sheet.slots[0] + 1}` : ''}</b>
                <span>{sheetExt.w} × {Math.max(sheetExt.h, 0)} × {hl.DEPTH_MM}mm</span>
                {sheet.slots.map((b) => (
                  <label key={b} title="Its own sheet, its own dimensions — still the same hub">
                    <input type="checkbox" checked={cur.separate.includes(b)} onChange={() => edit({
                      separate: cur.separate.includes(b)
                        ? cur.separate.filter((x) => x !== b) : [...cur.separate, b],
                    })} />bay {b + 1} separate
                  </label>
                ))}
              </div>
              <svg className="hub-svg" width={W + 56} height={H + 34}
                ref={(el) => { bayEls.current[`s${si}`] = el; }}
                onMouseMove={(e) => {
                  if (!drag) return;
                  const r = bayEls.current[`s${si}`].getBoundingClientRect();
                  const bx = (e.clientX - r.left - 40) / SCALE;
                  const local = Math.max(0, Math.min(sheet.slots.length - 1, Math.floor(bx / pitch)));
                  const y = (r.bottom - 24 - e.clientY) / SCALE;
                  setDrag({ ...drag, overBay: sheet.slots[local], atIndex: hl.dropIndex(bays[local], y, { slotWidth: bayOuter }) });
                }}>
                <defs>
                  <pattern id={`hatch-${si}`} width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
                    <line x1="0" y1="0" x2="0" y2="6" stroke="#9aa5b1" strokeWidth="1.2" />
                  </pattern>
                </defs>
                <g transform="translate(40,10)">
                  <rect x="0" y="0" width={W} height={H} fill="#fff" stroke="#16212e" strokeWidth="2" />
                  {/* Cable trunking, per zone. A run of upright drivers has it
                      down both sides; a turned row has it above and below and
                      takes the full bay width instead — which is how HUB-A gets
                      four DualDrives wall to wall over a 280 column. */}
                  {rows.map((r, n) => {
                    const t = px(hl.TRUNK);
                    const yTop = H - px(r.y + r.h);
                    const bands = r.hatched
                      ? [[px(r.x0), yTop, px(bayOuter), t],
                        [px(r.x0), H - px(r.y) - t, px(bayOuter), t]]
                      : [[px(r.x0), yTop, t, px(r.h)],
                        [px(r.x0 + bayOuter) - t, yTop, t, px(r.h)]];
                    return bands.map(([bx, by, bw, bh], k) => (
                      // no outline: the bands of one zone abut the next, and a
                      // stroke on each turns a continuous run of trunking into a
                      // ladder of ruled-off boxes
                      <rect key={`r${n}-${k}`} x={bx} y={by} width={bw} height={bh}
                        fill={`url(#hatch-${si})`} stroke="none" />
                    ));
                  })}

                  {placed.map((p) => {
                    const y = H - px(p.y) - px(p.size[1]);
                    const x = px(p.x);
                    const isFeed = p.kind === 'feed';
                    return (
                      <g key={p.ref} className={`hub-g ${sel.includes(p.ref) ? 'is-sel' : ''} ${drag?.ref === p.ref ? 'is-dragging' : ''}`}
                        onMouseDown={(e) => {
                          if (isFeed) return;
                          toggle(p.ref, e.shiftKey || e.metaKey || e.ctrlKey);
                          setDrag({ ref: p.ref, overBay: null, atIndex: 0 });
                        }}>
                        {isFeed ? (
                          <>
                            <rect x={x} y={y} width={px(p.size[0])} height={px(p.size[1])}
                              fill={`url(#hatch-${si})`} stroke="#16212e" />
                            <text x={x + px(p.size[0]) / 2} y={y + px(p.size[1]) / 2 + 3}
                              className="hub-t" textAnchor="middle" fontSize="8">Feed Provision</text>
                          </>
                        ) : (() => {
                          // A turned module turns as one: its parts, its
                          // lettering and its corners all come with it, rather
                          // than the outer box swapping while the inside stays
                          // put — which is what tore it apart before.
                          const body = p.rot === 90 ? [p.size[1], p.size[0]] : p.size;
                          const parts = p.parts?.length ? p.parts
                            : [{ kind: 'driver', label: p.label, size: body, at: [0, 0] }];
                          // rotate(-90) sends (u,v) to (v,-u), so the group has
                          // to be dropped by the body's LENGTH first — dropping
                          // it by the width put a turned block half its length
                          // too high, over whatever sat above it.
                          const frame = p.rot === 90
                            ? `translate(${x},${y + px(body[0])}) rotate(-90)`
                            : `translate(${x},${y})`;
                          return (
                            <g transform={frame}>
                              {parts.map((sub, n) => {
                                const sx = px(sub.at[0]);
                                const sy = px(body[1]) - px(sub.at[1]) - px(sub.size[1]);
                                const w = px(sub.size[0]);
                                const h2 = px(sub.size[1]);
                                // The 101676 idiom: filled by what the part is,
                                // lettered across if it fits and turned if it
                                // does not — which is the Panduit case, and what
                                // the old shrink-and-ellipsise got wrong.
                                const fill = draw.fillFor(sub.kind);
                                const ink = draw.inkFor(fill);
                                const t = draw.labelPlan(sub.label,
                                  draw.subLabel(sub.ref, sub.size[0]), w, h2,
                                  { base: 9, min: 5 });
                                const cx = sx + w / 2;
                                const cy = sy + h2 / 2;
                                return (
                                  <g key={n}>
                                    <rect x={sx} y={sy} width={w} height={h2}
                                      rx={sub.kind === 'driver' ? 4 : 0}
                                      fill={fill} stroke={draw.STROKE} strokeWidth="1.1" />
                                    {t.mode === 'across' && (
                                      <text className="hub-t" fill={ink} fontSize={t.size}
                                        x={cx} y={t.sub ? cy - 1 : cy + t.size / 3}
                                        textAnchor="middle">{sub.label}</text>
                                    )}
                                    {t.mode === 'across' && t.sub && (
                                      <text className="hub-t" fill={ink} fontSize={t.size * 0.78}
                                        x={cx} y={cy + t.size} textAnchor="middle"
                                        opacity="0.85">{t.sub}</text>
                                    )}
                                    {t.mode === 'turned' && (
                                      <text className="hub-t" fill={ink} fontSize={t.size}
                                        x={cx} y={cy} textAnchor="middle"
                                        transform={`rotate(-90,${cx},${cy})`}>{sub.label}</text>
                                    )}
                                    <title>{sub.full ?? sub.label}</title>
                                  </g>
                                );
                              })}
                            </g>
                          );
                        })()}
                      </g>
                    );
                  })}

                  {bounds && placed.filter((p) => p.kind !== 'feed').map((p) => {
                    const y = H - px(p.y) - px(p.size[1]);
                    const x = px(p.x);
                    const cx = px(p.clear?.x ?? hl.CLEAR_X);
                    const cy = px(p.clear?.y ?? hl.CLEAR_Y);
                    const w = px(p.size[0]); const h2 = px(p.size[1]);
                    return (
                      <g key={`${p.ref}-env`} className="hub-envelope">
                        <rect x={x - cx} y={y - cy} width={w + cx * 2} height={h2 + cy * 2} />
                        <line x1={x + w / 2} y1={y - cy} x2={x + w / 2} y2={y + h2 + cy} />
                        <line x1={x - cx} y1={y + h2 / 2} x2={x + w + cx} y2={y + h2 / 2} />
                      </g>
                    );
                  })}

                  {drag?.overBay != null && sheet.slots.includes(drag.overBay) && (() => {
                    const local = sheet.slots.indexOf(drag.overBay);
                    const upto = hl.dropY(bays[local], drag.atIndex, bayOuter);
                    return <line className="hub-drop" x1={px(local * pitch) + 2}
                      x2={px(local * pitch + bayOuter) - 2} y1={H - px(upto)} y2={H - px(upto)} />;
                  })()}

                  <g className="hub-dimline">
                    <line x1="-14" y1="0" x2="-14" y2={H} />
                    <line x1="-18" y1="0" x2="-10" y2="0" />
                    <line x1="-18" y1={H} x2="-10" y2={H} />
                    <text x="-20" y={H / 2} textAnchor="middle" transform={`rotate(-90,-20,${H / 2})`}>
                      {Math.max(sheetExt.h, 0)}
                    </text>
                    <line x1="0" y1={H + 12} x2={W} y2={H + 12} />
                    <line x1="0" y1={H + 8} x2="0" y2={H + 16} />
                    <line x1={W} y1={H + 8} x2={W} y2={H + 16} />
                    <text x={W / 2} y={H + 26} textAnchor="middle">{sheetExt.w}</text>
                  </g>
                </g>
              </svg>
            </div>
          );
        })}
      </div>

      <div className="hub-controls">
        <span className="hub-bays">
          bays
          <button disabled={cur.bays.length <= 1} onClick={() => edit({ bays: hl.removeBay(cur.bays), separate: [] })}>−</button>
          {cur.bays.length}
          <button onClick={() => edit({ bays: hl.addBay(cur.bays) })}>+</button>
        </span>
        <label className="fld hub-fit">
          <span className="fld-col">total width</span>
          <span className="fld-box">
            <input type="number" step="5" style={{ width: 74 }}
              placeholder={String(Math.round(hl.BAY_WIDTH * cur.bays.length))} value={cur.width ?? ''}
              onChange={(e) => edit({ width: e.target.value === '' ? null : +e.target.value })} />mm
          </span>
        </label>
        <label className="fld hub-fit">
          <span className="fld-col">must fit in</span>
          <span className="fld-box">
            <input type="number" style={{ width: 64 }} placeholder="w" value={cur.target.w}
              onChange={(e) => edit({ target: { ...cur.target, w: e.target.value } })} />×
            <input type="number" style={{ width: 64 }} placeholder="h" value={cur.target.h}
              onChange={(e) => edit({ target: { ...cur.target, h: e.target.value } })} />
          </span>
        </label>
        <label className="hub-check">
          <input type="checkbox" checked={cur.feed} onChange={() => edit({ feed: !cur.feed })} />feed provision
        </label>
        <label className="hub-check">
          <input type="checkbox" checked={bounds} onChange={() => setBounds(!bounds)} />
          bounding lines
        </label>
        <button className="btn btn-sm btn-link p-0" onClick={() => edit({ bays: hl.rebalance(cur.bays) })}>
          Auto-arrange
        </button>
        {sel.length > 0 && (
          <>
            <span className="hub-bays">
              junction boxes
              {/* the count starts at one per output on CV and none on CC, and is
                  reduced from there — a run is often broken out fewer times than
                  the driver has outputs */}
              <button onClick={() => setJboxes(null)} title="Back to one per output on CV, none on CC">auto</button>
              {[0, 1, 2, 3, 4].map((n) => (
                <button key={n} onClick={() => setJboxes(n)}>{n}</button>
              ))}
            </span>
            <button className="btn btn-sm btn-outline-secondary"
              onClick={() => edit({ bays: sel.reduce((bs, r) => hl.rotate(bs, r), cur.bays) })}
              title="Stand it on its side, as HUB-A does across its top zone">
              Rotate 90°
            </button>
            <button className="btn btn-sm btn-outline-primary"
              onClick={() => { edit({ bays: hl.splitToBay(cur.bays, sel) }); setSel([]); }}>
              Split {sel.length} into a new bay
            </button>
          </>
        )}
      </div>
    </div>
  );
}
