import { useEffect, useMemo, useRef, useState } from 'react';
import { PARTS, resolveSpec } from '../engine.js';
import * as api from '../api.js';
import { effectiveDrivers } from '../state.js';
import * as hl from '../hubLayout.js';
import * as draw from '../core/draw.js';
import { formatParams } from '../core/params.js';
import { hubPatch } from '../drivers/hubPatch.js';

// Composing one PSU hub, drawn the way 5642600A draws it: equipment as plain
// labelled blocks with the drivers rounded, cable trunking hatched, Feed
// Provision hatched, dimensions called out on the outside.
//
// A bay is a stack, so dragging reorders rather than positions: two blocks
// cannot overlap and the gap between neighbours is always the clearance they
// carry. The millimetres fall out of the sequence.
//
// Everything that belongs to a bay is set on that bay, from the menu above it:
// its width, what it must fit in, whether it carries Feed Provision, whether its
// bounding lines are drawn, and whether it stands apart as its own piece of
// joinery. A hub is not always two identical bays.

const JBOX = (n) => ({ kind: 'jbox', label: 'JUNCTION BOX', size: [80, 35, 40], ref: `jb${n}` });

// How many junction boxes a driver brings before anybody edits it. A constant
// voltage run is broken out at a box per output, so a 4-output CV driver arrives
// with 4. Constant current is a home run per output straight to the fitting, so
// it brings none.
export function defaultJboxes(spec, type) {
  const power = spec?.powerType ?? type?.powerType ?? null;
  if (power !== 'CV') return 0;
  return spec?.outputs ?? type?.nodes?.length ?? type?.outputs ?? 1;
}

const composite = (parts) => (parts.some((p) => p.kind === 'driver' && p.size)
  ? hl.composite(parts.filter((p) => p.size)) : null);

// A driver, its supply and its junction boxes, as one module. A size the
// ElementType already states wins over a datasheet figure: it is the design's
// own, and patching it back unchanged is the point.
function moduleFor(driver, jboxes, stated = {}) {
  const spec = resolveSpec(driver.name || driver.typeName || driver.typeRef);
  const part = spec?.driver ?? spec ?? null;
  const supply = spec?.supply ?? null;
  const own = stated[driver.typeRef] ?? null;
  const n = jboxes ?? defaultJboxes(spec, driver);
  const parts = own
    ? [{ kind: 'driver', label: part?.code ?? driver.typeRef, size: own,
      full: `${driver.typeRef}, sized from its ElementType` }]
    : [
      { kind: 'driver', label: part?.code ?? part?.name ?? driver.typeRef, size: part?.sizeMm ?? null,
        full: part?.name ?? driver.typeRef },
      ...(supply ? [{ kind: 'psu', label: supply.code ?? supply.name, size: supply.sizeMm ?? null,
        full: supply.name }] : []),
    ];
  parts.push(...Array.from({ length: n }, (_, i) => JBOX(i)));
  const built = composite(parts);
  return {
    ref: driver.ref,
    typeRef: driver.typeRef,
    label: driver.typeRef,
    kind: 'module',
    jboxes: n,
    sizedBy: own ? 'type' : 'datasheet',
    missing: parts.filter((p) => !p.size).map((p) => p.full ?? p.label),
    size: built?.size ?? null,
    parts: built?.parts ?? [],
  };
}

const bayDefaults = (feed = false) => ({
  width: null, feed, bounds: false, target: { w: '', h: '' }, separate: false, ref: '',
});

// px per mm. The drawing used to be fixed at 0.36, which is small on a screen.
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 1.5;

export default function HubLayoutLab({ state, zone = null, onBack = null }) {
  const { model, addedDrivers } = state;
  const drivers = useMemo(
    () => effectiveDrivers(model, addedDrivers, state.deletedDrivers),
    [model, addedDrivers, state.deletedDrivers],
  );
  // sizes the workbook's ElementTypes already state
  const stated = useMemo(() => api.typeSizes(), [model]);
  const hubs = model.zones;
  const [hub, setHub] = useState(hubs.includes(zone) ? zone : hubs[0] ?? null);
  const [st, setSt] = useState({});
  const [sel, setSel] = useState([]);
  const [drag, setDrag] = useState(null);
  const [sizes, setSizes] = useState({});
  const [hist, setHist] = useState({ undo: [], redo: [] });
  const [scale, setScale] = useState(0.55);
  const [menu, setMenu] = useState(null);         // bay index whose menu is open
  const [copied, setCopied] = useState(false);
  const svgEls = useRef({});
  const menuEl = useRef(null);
  const px = (n) => n * scale;

  const cur = st[hub] ?? null;

  useEffect(() => {
    if (!hub || st[hub]) return;
    const items = drivers.filter((d) => d.zone === hub).map((d) => moduleFor(d, null, stated));
    setSt((s) => ({ ...s, [hub]: { bays: [items], opts: [bayDefaults(true)] } }));
  }, [hub, drivers, st, stated]);

  // a bay menu closes when you click anywhere outside it
  useEffect(() => {
    if (menu == null) return undefined;
    const onDoc = (e) => {
      if (menuEl.current?.contains(e.target) || e.target.closest?.('.hub-baytab')) return;
      setMenu(null);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menu]);

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

  const opt = (b) => cur.opts[b] ?? bayDefaults();
  const setOpt = (b, patch) => edit({ opts: cur.opts.map((o, i) => (i === b ? { ...o, ...patch } : o)) });
  const widthOf = (b) => (opt(b).width > 0 ? opt(b).width : hl.BAY_WIDTH);
  const withFeed = (items, b) => (opt(b).feed
    ? [hl.feedItem(widthOf(b) - hl.TRUNK * 2, 105), ...items] : items);
  const separate = cur.opts.map((o, i) => (o.separate ? i : null)).filter((i) => i != null);

  const applySizes = (items) => items.map((i) => {
    const d = drivers.find((x) => x.ref === i.ref);
    if (!d) return i;
    const m = moduleFor(d, i.jboxes, stated);
    return m.parts.length ? { ...m, rot: i.rot } : i;
  });

  // the whole hub, for the header and the patch
  const allBays = cur.bays.map(withFeed);
  const allWidths = cur.bays.map((_, b) => widthOf(b));
  const ext = hl.extent(allBays, { widths: allWidths });
  const missing = [...new Set(cur.bays.flat().flatMap((i) => i.missing ?? []))];

  const toggle = (ref, add) => setSel((c) => (add
    ? (c.includes(ref) ? c.filter((r) => r !== ref) : [...c, ref])
    : (c.includes(ref) && c.length === 1 ? [] : [ref])));

  const onDrop = () => {
    if (drag?.overBay != null) edit({ bays: hl.moveItem(cur.bays, drag.ref, drag.overBay, drag.atIndex) });
    setDrag(null);
  };

  const setJboxes = (n) => edit({
    bays: cur.bays.map((b) => b.map((i) => {
      if (!sel.includes(i.ref)) return i;
      const d = drivers.find((x) => x.ref === i.ref);
      return d ? { ...moduleFor(d, n, stated), rot: i.rot } : i;
    })),
  });

  const addBay = () => edit({ bays: hl.addBay(cur.bays), opts: [...cur.opts, bayDefaults()] });
  const removeBay = () => edit({ bays: hl.removeBay(cur.bays), opts: cur.opts.slice(0, -1) });
  const splitSelected = () => {
    edit({ bays: hl.splitToBay(cur.bays, sel), opts: [...cur.opts, bayDefaults()] });
    setSel([]);
  };

  // ---- the patch --------------------------------------------------------------
  // Positions in each bay, the hub's size, any separated bay as its own Element,
  // and every driver type's size merged into its ElementType. A size the type
  // already states comes back unchanged, so the patch leaves it as it was.
  const copyPatch = async () => {
    const ctx = state.context;
    const container = ctx?.hubRef
      ? { ref: ctx.hubRef, name: hub, contextType: ctx.hubContextType ?? 'Position' }
      : { name: hub };
    const wrapperRefs = Object.fromEntries(cur.opts
      .map((o, i) => [i, o.separate && o.ref.trim() ? o.ref.trim() : null])
      .filter(([, r]) => r));
    const saved = hl.save(allBays, { container, separate, widths: allWidths, wrapperRefs });
    const seen = new Map();
    for (const d of drivers.filter((x) => x.zone === hub)) {
      if (seen.has(d.typeRef)) continue;
      const size = moduleFor(d, 0, stated).size;
      if (!size?.[0] || !size?.[1]) continue;
      seen.set(d.typeRef, formatParams({ size: [size[0], size[1], size[2] > 0 ? size[2] : null] }));
    }
    const typeSizes = [...seen].map(([ref, size]) => ({ ref, size }));
    await api.copyPatch(hubPatch({ saved, hub: container.ref ? container : null, typeSizes }));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

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
          onChange={(e) => { setHub(e.target.value); setSel([]); setMenu(null); setHist({ undo: [], redo: [] }); }}>
          {hubs.map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
        <h5 className="mb-0 hub-dim">{ext.w} × {ext.h} × {hl.DEPTH_MM}mm</h5>
        <span className="hub-zoom" title="Zoom">
          <button onClick={() => setScale((z) => Math.max(ZOOM_MIN, +(z - 0.1).toFixed(2)))} aria-label="Zoom out">-</button>
          <span>{Math.round((scale / 0.36) * 100)}%</span>
          <button onClick={() => setScale((z) => Math.min(ZOOM_MAX, +(z + 0.1).toFixed(2)))} aria-label="Zoom in">+</button>
        </span>
        <span className="ms-auto d-flex align-items-center gap-2">
          <button className="btn btn-sm btn-outline-secondary" disabled={!hist.undo.length} onClick={undo}
            title="Undo"><span className="material-icons small-icon align-middle">undo</span></button>
          <button className="btn btn-sm btn-outline-secondary" disabled={!hist.redo.length} onClick={redo}
            title="Redo"><span className="material-icons small-icon align-middle">redo</span></button>
          <button className="btn btn-sm btn-primary" onClick={copyPatch}
            title="Copy an ExcelScript patch: driver positions, the hub's size, separated bays and each driver type's size">
            <span className="material-icons small-icon align-middle">{copied ? 'check' : 'content_copy'}</span>
            {copied ? ' Copied' : ' Copy patch'}
          </button>
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
        {hl.sheets(cur.bays.length, separate).map((sheet, si) => {
          // Joined bays are one cabinet with a divider: they share the gap
          // between them, so the centre is 50 and not 100.
          const bays = sheet.slots.map((b) => withFeed(cur.bays[b], b));
          const widths = sheet.slots.map((b) => widthOf(b));
          const lopts = { widths };
          const off = hl.offsetsOf(bays.length, lopts);
          const sheetExt = hl.extent(bays, lopts);
          const H = px(Math.max(sheetExt.h, 150));
          const W = px(sheetExt.w);
          const placed = hl.placements(bays, lopts);
          // the trunking is a property of a ROW: down each side of an upright
          // run, across the ends of a turned one
          const rows = bays.flatMap((items, local) =>
            hl.packBay(items, widths[local]).map((r) => ({ ...r, x0: off[local], bw: widths[local] })));
          const LEFT = 44;
          return (
            <div key={si} className="hub-sheet">
              <div className="hub-sheet-head">
                <b>{hub}{sheet.separate ? `-${sheet.slots[0] + 1}` : ''}</b>
                <span>{sheetExt.w} × {Math.max(sheetExt.h, 0)} × {hl.DEPTH_MM}mm</span>
              </div>

              {/* one tab over each bay, carrying that bay's own settings */}
              <div className="hub-baybar" style={{ width: W + LEFT + 16 }}>
                {sheet.slots.map((b, local) => {
                  const o = opt(b);
                  const bayExt = { w: widths[local], h: hl.bayHeight(bays[local], widths[local]) };
                  const verdict = (o.target.w || o.target.h) ? hl.fitsIn(bayExt, o.target) : null;
                  return (
                    <div key={b} className="hub-baytab" style={{ left: LEFT + px(off[local]), width: px(widths[local]) }}>
                      <span className="hub-baytab-name">bay {b + 1} · {widths[local]}</span>
                      {verdict && (
                        <span className={`hub-verdict ${verdict.fits ? 'is-ok' : 'is-over'}`}>
                          {verdict.fits ? 'fits' : `${Math.max(verdict.overW ?? 0, verdict.overH ?? 0)} over`}
                        </span>
                      )}
                      <button type="button" className="kebab-btn" title={`Bay ${b + 1} options`}
                        onClick={() => setMenu(menu === b ? null : b)}>
                        <span className="material-icons small-icon">more_vert</span>
                      </button>
                      {menu === b && (
                        <div className="hub-baymenu" ref={menuEl}>
                          <b>Bay {b + 1}</b>
                          <label className="hub-mrow">
                            <span>Width</span>
                            <input type="number" step="5" placeholder={String(hl.BAY_WIDTH)} value={o.width ?? ''}
                              onChange={(e) => setOpt(b, { width: e.target.value === '' ? null : +e.target.value })} />mm
                          </label>
                          <label className="hub-mrow">
                            <span>Must fit in</span>
                            <input type="number" placeholder="w" value={o.target.w}
                              onChange={(e) => setOpt(b, { target: { ...o.target, w: e.target.value } })} />×
                            <input type="number" placeholder="h" value={o.target.h}
                              onChange={(e) => setOpt(b, { target: { ...o.target, h: e.target.value } })} />
                          </label>
                          <label><input type="checkbox" checked={o.feed}
                            onChange={() => setOpt(b, { feed: !o.feed })} /> Feed provision</label>
                          <label><input type="checkbox" checked={o.bounds}
                            onChange={() => setOpt(b, { bounds: !o.bounds })} /> Bounding lines</label>
                          <label title="Its own sheet, its own dimensions and its own Element. Still the same hub.">
                            <input type="checkbox" checked={o.separate}
                              onChange={() => setOpt(b, { separate: !o.separate })} /> Separate
                          </label>
                          {o.separate && (
                            <label className="hub-mrow">
                              <span>Element Ref</span>
                              <input type="text" placeholder="allocate" value={o.ref}
                                onChange={(e) => setOpt(b, { ref: e.target.value })} style={{ width: 96 }} />
                            </label>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <svg className="hub-svg" width={W + LEFT + 16} height={H + 64}
                ref={(el) => { svgEls.current[`s${si}`] = el; }}
                onMouseMove={(e) => {
                  if (!drag) return;
                  const r = svgEls.current[`s${si}`].getBoundingClientRect();
                  const mmX = (e.clientX - r.left - LEFT) / scale;
                  let local = off.findIndex((o0, i) => mmX >= o0 && mmX < o0 + widths[i]);
                  if (local < 0) local = mmX < 0 ? 0 : bays.length - 1;
                  const y = (r.top + 10 + H - e.clientY) / scale;
                  setDrag({ ...drag, overBay: sheet.slots[local],
                    atIndex: hl.dropIndex(bays[local], y, { slotWidth: widths[local] }) });
                }}>
                <defs>
                  <pattern id={`hatch-${si}`} width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
                    <line x1="0" y1="0" x2="0" y2="6" stroke="#9aa5b1" strokeWidth="1.2" />
                  </pattern>
                </defs>
                <g transform={`translate(${LEFT},10)`}>
                  <rect x="0" y="0" width={W} height={H} fill="#fff" stroke="#16212e" strokeWidth="2" />
                  {rows.map((r, n) => {
                    const t = px(hl.TRUNK);
                    const yTop = H - px(r.y + r.h);
                    const bands = r.hatched
                      ? [[px(r.x0), yTop, px(r.bw), t], [px(r.x0), H - px(r.y) - t, px(r.bw), t]]
                      : [[px(r.x0), yTop, t, px(r.h)], [px(r.x0 + r.bw) - t, yTop, t, px(r.h)]];
                    return bands.map(([bx, by, bw, bh], k) => (
                      // no outline, so a run of trunking reads as one band
                      <rect key={`r${n}-${k}`} x={bx} y={by} width={bw} height={bh}
                        fill={`url(#hatch-${si})`} stroke="none" />
                    ));
                  })}

                  {placed.map((p) => {
                    const y = H - px(p.y) - px(p.size[1]);
                    const x = px(p.x);
                    const isFeed = p.kind === 'feed';
                    return (
                      <g key={`${p.ref}-${p.slot}`}
                        className={`hub-g ${sel.includes(p.ref) ? 'is-sel' : ''} ${drag?.ref === p.ref ? 'is-dragging' : ''}`}
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
                              className="hub-t" textAnchor="middle" fontSize={Math.max(7, 22 * scale)}>Feed Provision</text>
                          </>
                        ) : (() => {
                          // a turned module turns as one: its parts and its
                          // lettering come with it
                          const body = p.rot === 90 ? [p.size[1], p.size[0]] : p.size;
                          const parts = p.parts?.length ? p.parts
                            : [{ kind: 'driver', label: p.label, size: body, at: [0, 0] }];
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
                                // plain blocks, as the space drawings are: no fill
                                // by class here, only the lettering placed to fit
                                const t = draw.labelPlan(sub.label,
                                  // a junction box's "jb0" is the drawing's own
                                  // bookkeeping, not an Element: size only
                                  draw.subLabel(sub.kind === 'jbox' ? null : sub.ref, sub.size[0]), w, h2,
                                  { base: Math.max(7, 25 * scale), min: 5 });
                                const cx = sx + w / 2;
                                const cy = sy + h2 / 2;
                                return (
                                  <g key={n}>
                                    <rect x={sx} y={sy} width={w} height={h2}
                                      rx={sub.kind === 'driver' ? 4 : 0}
                                      fill="#fff" stroke={draw.STROKE} strokeWidth="1.1" />
                                    {t.mode === 'across' && (
                                      <text className="hub-t" fill="#111" fontSize={t.size}
                                        x={cx} y={t.sub ? cy - 1 : cy + t.size / 3}
                                        textAnchor="middle">{sub.label}</text>
                                    )}
                                    {t.mode === 'across' && t.sub && (
                                      <text className="hub-t" fill="#475569" fontSize={t.size * 0.78}
                                        x={cx} y={cy + t.size} textAnchor="middle">{t.sub}</text>
                                    )}
                                    {t.mode === 'turned' && (
                                      <text className="hub-t" fill="#111" fontSize={t.size}
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

                  {placed.filter((p) => p.kind !== 'feed' && opt(sheet.slots[p.slot]).bounds).map((p) => {
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
                    const upto = hl.dropY(bays[local], drag.atIndex, widths[local]);
                    return <line className="hub-drop" x1={px(off[local]) + 2}
                      x2={px(off[local] + widths[local]) - 2} y1={H - px(upto)} y2={H - px(upto)} />;
                  })()}

                  {/* dimensions: height on the left, each bay's width under it,
                      and the overall width under that when there is more than one */}
                  <g className="hub-dimline">
                    <line x1="-14" y1="0" x2="-14" y2={H} />
                    <line x1="-18" y1="0" x2="-10" y2="0" />
                    <line x1="-18" y1={H} x2="-10" y2={H} />
                    <text x="-22" y={H / 2} textAnchor="middle" transform={`rotate(-90,-22,${H / 2})`}>
                      {Math.max(sheetExt.h, 0)}
                    </text>
                    {bays.map((_, local) => {
                      const x0 = px(off[local]);
                      const x1 = px(off[local] + widths[local]);
                      return (
                        <g key={local}>
                          <line x1={x0} y1={H + 12} x2={x1} y2={H + 12} />
                          <line x1={x0} y1={H + 8} x2={x0} y2={H + 16} />
                          <line x1={x1} y1={H + 8} x2={x1} y2={H + 16} />
                          <text x={(x0 + x1) / 2} y={H + 26} textAnchor="middle">{widths[local]}</text>
                        </g>
                      );
                    })}
                    {bays.length > 1 && (
                      <>
                        <line x1="0" y1={H + 36} x2={W} y2={H + 36} />
                        <line x1="0" y1={H + 32} x2="0" y2={H + 40} />
                        <line x1={W} y1={H + 32} x2={W} y2={H + 40} />
                        <text x={W / 2} y={H + 50} textAnchor="middle">{sheetExt.w}</text>
                      </>
                    )}
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
          <button disabled={cur.bays.length <= 1} onClick={removeBay}>−</button>
          {cur.bays.length}
          <button onClick={addBay}>+</button>
        </span>
        <button className="btn btn-sm btn-link p-0" onClick={() => edit({ bays: hl.rebalance(cur.bays) })}>
          Auto-arrange
        </button>
        {sel.length > 0 && (
          <>
            <span className="hub-bays">
              junction boxes
              {/* one per output on CV and none on CC to start, reduced from there */}
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
            <button className="btn btn-sm btn-outline-primary" onClick={splitSelected}>
              Split {sel.length} into a new bay
            </button>
          </>
        )}
      </div>
    </div>
  );
}
