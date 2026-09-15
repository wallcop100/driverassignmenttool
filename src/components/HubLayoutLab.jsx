import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveSpec } from '../engine.js';
import * as api from '../api.js';
import { effectiveDrivers, outRef } from '../state.js';
import * as hl from '../hubLayout.js';
import * as draw from '../core/draw.js';
import { formatParams } from '../core/params.js';
import { hubPatch } from '../drivers/hubPatch.js';
import Origin from './Origin.jsx';

// Composing one PSU hub, drawn the way 5642600A draws it: equipment as plain
// labelled blocks with the drivers rounded, cable trunking hatched, Feed
// Provision hatched yellow, dimensions called out on the outside.
//
// A bay is a stack, so dragging reorders rather than positions: two blocks
// cannot overlap and the gap between neighbours is always the clearance they
// carry. The millimetres fall out of the sequence.
//
// Almost no project states a driver's size yet (0 of 103 driver types across
// five live sets), so most blocks are drawn at a datasheet figure the tool
// supplied. That is allowed, so work can carry on, but it is never allowed to
// look like the design's own: a datasheet size is outlined dotted, a size typed
// here dashed amber, and only a size from the DB is drawn solid.

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

// A driver, its supply and its junction boxes, as one module, or a Feed
// Provision Element as one block. `sizes` is { edited, db }: what was typed here
// and what the ElementTypes state. A stated size is the type's whole body; a
// datasheet one is composed from the parts the name resolves to.
function moduleFor(driver, jboxes, sizes = {}) {
  const spec = resolveSpec(driver.name || driver.typeName || driver.typeRef);
  const part = spec?.driver ?? spec ?? null;
  const supply = spec?.supply ?? null;
  const feed = hl.isFeed(driver.typeRef);
  const label = feed ? 'Feed Provision' : part?.code ?? part?.name ?? driver.typeRef;
  const sheet = feed
    ? [{ kind: 'feed', label, size: hl.FEED_SIZE, full: `${driver.typeRef}, no size stated` }]
    : [
      { kind: 'driver', label, size: part?.sizeMm ?? null, full: part?.name ?? driver.typeRef },
      ...(supply ? [{ kind: 'psu', label: supply.code ?? supply.name, size: supply.sizeMm ?? null,
        full: supply.name }] : []),
    ];
  const { size: own, origin } = hl.resolveSize({
    edited: sizes.edited?.[driver.typeRef]?.size,
    db: sizes.db?.[driver.typeRef],
    datasheet: feed ? hl.FEED_SIZE : composite(sheet)?.size,
  });
  const stated = origin === 'edited' || origin === 'db';
  const body = stated
    ? [{ kind: feed ? 'feed' : 'driver', label, size: own,
      full: `${driver.typeRef}, sized from ${origin === 'db' ? 'its ElementType' : 'the size typed here'}` }]
    : sheet;
  const n = feed ? 0 : jboxes ?? defaultJboxes(spec, driver);
  const parts = [...body, ...Array.from({ length: n }, (_, i) => JBOX(i))];
  const built = feed
    ? (body[0].size ? { size: body[0].size, parts: [{ ...body[0], at: [0, 0] }] } : null)
    : composite(parts);
  return {
    ref: driver.ref,
    typeRef: driver.typeRef,
    label: driver.typeRef,
    kind: feed ? 'feed' : 'module',
    jboxes: n,
    sizedBy: built ? origin : 'missing',
    missing: stated ? [] : sheet.filter((p) => !p.size).map((p) => p.full ?? p.label),
    size: built?.size ?? null,
    parts: built?.parts ?? [],
  };
}

// Feed Provision sits at the bottom of a bay, as every hub drawing has it.
const feedFirst = (items) => [...items.filter((i) => i.kind === 'feed'), ...items.filter((i) => i.kind !== 'feed')];

const bayDefaults = () => ({
  width: null, bounds: false, target: { w: '', h: '' }, separate: false, ref: '',
});

// The outline says where a block's size came from.
const LINE = {
  db: { stroke: draw.STROKE },
  datasheet: { stroke: '#64748b', strokeDasharray: '3 2' },
  edited: { stroke: '#b7791f', strokeDasharray: '6 3' },
};

// px per mm. The drawing used to be fixed at 0.36, which is small on a screen.
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 1.5;

export default function HubLayoutLab({ state, dispatch, zone = null, onBack = null }) {
  const { model, addedDrivers } = state;
  const drivers = useMemo(
    () => effectiveDrivers(model, addedDrivers, state.deletedDrivers),
    [model, addedDrivers, state.deletedDrivers],
  );
  // what the workbook already states: sizes on ElementTypes, TBC flags
  const stated = useMemo(() => api.typeSizes(), [model]);
  const dbTbc = useMemo(() => api.tbcFlags(), [model]);
  const sizes = useMemo(() => ({ edited: state.typeSizes ?? {}, db: stated }), [state.typeSizes, stated]);
  const hubs = model.zones;
  const [hub, setHub] = useState(hubs.includes(zone) ? zone : hubs[0] ?? null);
  const [st, setSt] = useState({});
  const [sel, setSel] = useState([]);
  const [drag, setDrag] = useState(null);
  const [hist, setHist] = useState({ undo: [], redo: [] });
  const [scale, setScale] = useState(0.55);
  const [menu, setMenu] = useState(null);         // bay index whose menu is open
  const [copied, setCopied] = useState(false);
  const [pick, setPick] = useState(null);         // a sizeless type chosen from the legend
  const [draft, setDraft] = useState(null);       // { typeRef, w, h, d } in the inspector
  const [skip, setSkip] = useState([]);           // typeRefs whose size is left out of the patch
  const svgEls = useRef({});
  const menuEl = useRef(null);
  const px = (n) => n * scale;

  const cur = st[hub] ?? null;

  useEffect(() => {
    if (!hub || st[hub]) return;
    const items = drivers.filter((d) => d.zone === hub).map((d) => moduleFor(d, null, sizes));
    setSt((s) => ({ ...s, [hub]: { bays: [feedFirst(items)], opts: [bayDefaults()] } }));
  }, [hub, drivers, st, sizes]);

  // A size belongs to the type, so saving one redraws every Element of it in
  // every hub already open. Not an undo step: it is the set's, like a preset.
  useEffect(() => {
    setSt((s) => Object.fromEntries(Object.entries(s).map(([h, v]) => [h, {
      ...v,
      bays: v.bays.map((b) => b.map((i) => {
        const d = drivers.find((x) => x.ref === i.ref);
        return d ? { ...moduleFor(d, i.jboxes, sizes), rot: i.rot } : i;
      })),
    }])));
  }, [sizes, drivers]);

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

  // one type per hub, sized with no junction boxes: what its ElementType states
  const hubDrivers = drivers.filter((d) => d.zone === hub);
  const types = [...new Map(hubDrivers.map((d) => [d.typeRef, moduleFor(d, 0, sizes)])).values()];

  // the inspector follows a single selected block, or a sizeless type picked
  // from the legend, since that one has no block to click
  const focusItem = sel.length === 1 ? cur?.bays.flat().find((i) => i.ref === sel[0]) : null;
  const focusType = focusItem?.typeRef ?? pick;
  const focusModule = types.find((m) => m.typeRef === focusType) ?? null;
  const focusRef = focusItem?.ref ?? hubDrivers.find((d) => d.typeRef === focusType)?.ref ?? null;
  const focusKey = `${focusType}|${focusModule?.size?.join(',') ?? ''}`;
  useEffect(() => {
    if (!focusModule) { setDraft(null); return; }
    const [w = '', h = '', d = ''] = focusModule.size ?? [];
    setDraft({ typeRef: focusType, w, h, d });
  }, [focusKey]);

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
  // a bay nobody has given a width is as wide as what it holds, so the far
  // trunking sits against the equipment
  // a feed with no size of its own spans its bay instead of deciding its width
  const laid = cur.bays.map((b, i) => hl.spanFeeds(b, opt(i).width));
  const widthOf = (b) => (opt(b).width > 0 ? opt(b).width : hl.naturalWidth(laid[b]));
  const separate = cur.opts.map((o, i) => (o.separate ? i : null)).filter((i) => i != null);

  // TBC: the workbook's flags, with what was set here on top
  const flags = (ref) => ({ ...(dbTbc[ref] ?? {}), ...(state.tbc?.[ref] ?? {}) });
  const isTbc = (ref, typeRef) => [flags(ref), flags(typeRef)].some((f) => f.isTBC || f.isPropertiesTBC);
  const setFlag = (ref, sheet, key) => {
    const f = flags(ref);
    const next = { sheet, isTBC: !!f.isTBC, isPropertiesTBC: !!f.isPropertiesTBC, [key]: !f[key] };
    const db = dbTbc[ref] ?? {};
    const same = next.isTBC === !!db.isTBC && next.isPropertiesTBC === !!db.isPropertiesTBC;
    dispatch({ type: 'SET_TBC', ref, flags: same ? null : next });
  };

  // the whole hub, for the header and the patch
  const allWidths = cur.bays.map((_, b) => widthOf(b));
  const ext = hl.extent(laid, { widths: allWidths });
  const count = (o) => types.filter((m) => m.sizedBy === o).length;
  const tbcCount = hubDrivers.filter((d) => isTbc(d.ref, d.typeRef)).length;
  // A feed with no size is drawn at a placeholder, not a datasheet figure, so it
  // is never offered to the patch: somebody has to type the real one.
  const notInDb = types.filter((m) => m.size
    && (m.sizedBy === 'edited' || (m.sizedBy === 'datasheet' && m.kind !== 'feed')));
  const inPatch = notInDb.filter((m) => !skip.includes(m.typeRef));

  const toggle = (ref, add) => setSel((c) => (add
    ? (c.includes(ref) ? c.filter((r) => r !== ref) : [...c, ref])
    : (c.includes(ref) && c.length === 1 ? [] : [ref])));

  const onDrop = () => {
    if (drag?.overBay != null) edit({ bays: hl.moveItem(cur.bays, drag.ref, drag.overBay, drag.atIndex) });
    setDrag(null);
  };

  const setJboxes = (n) => edit({
    bays: cur.bays.map((b) => b.map((i) => {
      if (!sel.includes(i.ref) || i.kind === 'feed') return i;
      const d = drivers.find((x) => x.ref === i.ref);
      return d ? { ...moduleFor(d, n, sizes), rot: i.rot } : i;
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
  // every size that is not in the DB yet (unless it was left out), and the TBC
  // flags set here.
  const copyPatch = async () => {
    const ctx = state.context;
    const container = ctx?.hubRef
      ? { ref: ctx.hubRef, name: hub, contextType: ctx.hubContextType ?? 'Position' }
      : { name: hub };
    const wrapperRefs = Object.fromEntries(cur.opts
      .map((o, i) => [i, o.separate && o.ref.trim() ? o.ref.trim() : null])
      .filter(([, r]) => r));
    const saved = hl.save(laid, { container, separate, widths: allWidths, wrapperRefs });
    const typeSizes = inPatch.map((m) => ({
      ref: m.typeRef,
      size: formatParams({ size: [m.size[0], m.size[1], m.size[2] > 0 ? m.size[2] : null] }),
    }));
    const mine = new Set([...hubDrivers.map((d) => d.ref), ...types.map((m) => m.typeRef)]);
    const tbc = Object.entries(state.tbc ?? {})
      .filter(([ref]) => mine.has(ref))
      .map(([ref, f]) => ({ ...f, ref: f.sheet === 'E' ? outRef(ref) : ref }));
    await api.copyPatch(hubPatch({ saved, hub: container.ref ? container : null, typeSizes, tbc }));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const focusTbc = focusModule && isTbc(focusRef, focusType);

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
          onChange={(e) => {
            setHub(e.target.value); setSel([]); setPick(null); setMenu(null); setHist({ undo: [], redo: [] });
          }}>
          {hubs.map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
        <h5 className="mb-0 hub-dim">{ext.w} × {ext.h} × {hl.DEPTH_MM}mm</h5>
        <span className="hub-zoom" title="Zoom">
          <button onClick={() => setScale((z) => Math.max(ZOOM_MIN, +(z - 0.1).toFixed(2)))} aria-label="Zoom out">-</button>
          <span>{Math.round((scale / 0.36) * 100)}%</span>
          <button onClick={() => setScale((z) => Math.min(ZOOM_MAX, +(z + 0.1).toFixed(2)))} aria-label="Zoom in">+</button>
        </span>
        <span className="ms-auto d-flex align-items-center gap-2">
          {notInDb.length > 0 && (
            <details className="hub-inpatch">
              <summary>{inPatch.length} of {notInDb.length} sizes not in the DB go in the patch</summary>
              <div className="hub-inpatch-list">
                {notInDb.map((m) => (
                  <label key={m.typeRef}>
                    <input type="checkbox" checked={!skip.includes(m.typeRef)}
                      onChange={() => setSkip((s) => (s.includes(m.typeRef)
                        ? s.filter((x) => x !== m.typeRef) : [...s, m.typeRef]))} />
                    <span className="rv-ref">{m.typeRef}</span>
                    <span className="text-secondary">{formatParams({ size: m.size })}</span>
                    <Origin kind={m.sizedBy} what={`${m.typeRef}'s size`} />
                  </label>
                ))}
              </div>
            </details>
          )}
          <button className="btn btn-sm btn-outline-secondary" disabled={!hist.undo.length} onClick={undo}
            title="Undo"><span className="material-icons small-icon align-middle">undo</span></button>
          <button className="btn btn-sm btn-outline-secondary" disabled={!hist.redo.length} onClick={redo}
            title="Redo"><span className="material-icons small-icon align-middle">redo</span></button>
          <button className="btn btn-sm btn-primary" onClick={copyPatch}
            title="Copy an ExcelScript patch: positions, the hub's size, separated bays, sizes not in the DB and TBC flags">
            <span className="material-icons small-icon align-middle">{copied ? 'check' : 'content_copy'}</span>
            {copied ? ' Copied' : ' Copy patch'}
          </button>
          <span className="badge text-bg-warning">lab</span>
        </span>
      </div>

      {/* what in this hub is the DB's, and what the tool is standing in for */}
      <div className="hub-legend">
        <span>{types.length} type{types.length === 1 ? '' : 's'}:</span>
        {count('db') > 0 && <span>{count('db')} sized in the DB</span>}
        {count('datasheet') > 0 && <span><Origin kind="datasheet" what="These sizes" />{count('datasheet')}</span>}
        {count('edited') > 0 && <span><Origin kind="edited" what="These sizes" />{count('edited')}</span>}
        {tbcCount > 0 && <span><Origin kind="tbc" what="These Elements" />{tbcCount}</span>}
        {types.filter((m) => m.sizedBy === 'missing').map((m) => (
          <button key={m.typeRef} type="button" className="btn btn-sm btn-link p-0"
            onClick={() => { setSel([]); setPick(m.typeRef); }} title="Give this type a size">
            <Origin kind="missing" what={m.typeRef} /> {m.typeRef}
          </button>
        ))}
        <span className="text-secondary">Click a block to size it or flag it TBC.</span>
      </div>

      {focusModule && draft?.typeRef === focusType && (
        <div className="hub-inspect">
          <div className="hub-inspect-head">
            <b className="rv-ref">{focusType}</b>
            {focusModule.sizedBy !== 'db' && <Origin kind={focusModule.sizedBy} what={`${focusType}'s size`} />}
            {focusTbc && <Origin kind="tbc" what={focusType} />}
            <button type="button" className="btn-close ms-auto" aria-label="Close"
              onClick={() => { setSel([]); setPick(null); }} />
          </div>
          <div className="hub-sizes">
            {['w', 'h', 'd'].map((k) => (
              <label key={k} className="fld">
                <span className="fld-col">{k}</span>
                <span className="fld-box">
                  <input type="number" style={{ width: 64 }} value={draft[k]}
                    onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />mm
                </span>
              </label>
            ))}
            <button type="button" className="btn btn-sm btn-primary" disabled={!(+draft.w > 0 && +draft.h > 0)}
              onClick={() => dispatch({ type: 'SET_TYPE_SIZE', typeRef: focusType,
                size: [+draft.w, +draft.h, +draft.d > 0 ? +draft.d : 0] })}>
              Save to type
            </button>
            {state.typeSizes?.[focusType] && (
              <button type="button" className="btn btn-sm btn-outline-secondary"
                onClick={() => dispatch({ type: 'SET_TYPE_SIZE', typeRef: focusType, size: null })}>
                Back to the {stated[focusType] ? 'DB' : 'datasheet'} size
              </button>
            )}
          </div>
          <div className="hub-inspect-flags">
            {focusRef && (
              <label>
                <input type="checkbox" checked={!!flags(focusRef).isTBC}
                  onChange={() => setFlag(focusRef, 'E', 'isTBC')} />
                <span className="rv-ref">{outRef(focusRef)}</span> is TBC
              </label>
            )}
            <label>
              <input type="checkbox" checked={!!flags(focusType).isPropertiesTBC}
                onChange={() => setFlag(focusType, 'ET', 'isPropertiesTBC')} />
              <span className="rv-ref">{focusType}</span> properties TBC
            </label>
          </div>
          <div className="text-secondary small">
            A size belongs to the type, so it applies to every {focusType} in the set.
            {focusModule.missing.length > 0 && ` No datasheet size for ${focusModule.missing.join(', ')}.`}
          </div>
        </div>
      )}

      <div className="hub-sheets">
        {hl.sheets(cur.bays.length, separate).map((sheet, si) => {
          // Joined bays are one cabinet with a divider: they share the gap
          // between them, so the centre is 50 and not 100.
          const bays = sheet.slots.map((b) => laid[b]);
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
                  // a typed width the equipment does not fit in
                  const narrow = o.width > 0 ? hl.naturalWidth(bays[local], o.width) - o.width : 0;
                  return (
                    <div key={b} className="hub-baytab" style={{ left: LEFT + px(off[local]), width: px(widths[local]) }}>
                      <span className="hub-baytab-name">bay {b + 1} · {widths[local]}</span>
                      {narrow > 0 && <span className="hub-verdict is-over">{narrow} over</span>}
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
                          <label className="hub-mrow" title="Blank follows what the bay holds">
                            <span>Width</span>
                            <input type="number" step="5" placeholder={String(hl.naturalWidth(laid[b]))}
                              value={o.width ?? ''}
                              onChange={(e) => setOpt(b, { width: e.target.value === '' ? null : +e.target.value })} />mm
                          </label>
                          <label className="hub-mrow">
                            <span>Must fit in</span>
                            <input type="number" placeholder="w" value={o.target.w}
                              onChange={(e) => setOpt(b, { target: { ...o.target, w: e.target.value } })} />×
                            <input type="number" placeholder="h" value={o.target.h}
                              onChange={(e) => setOpt(b, { target: { ...o.target, h: e.target.value } })} />
                          </label>
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
                  {/* yellow: Feed Provision, and anything to be confirmed */}
                  <pattern id={`yhatch-${si}`} width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
                    <rect width="6" height="6" fill="#fffbe6" />
                    <line x1="0" y1="0" x2="0" y2="6" stroke="#f2c200" strokeWidth="1.6" />
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
                    const tbc = isTbc(p.ref, p.typeRef);
                    // a turned module turns as one: its parts and its
                    // lettering come with it
                    const body = p.rot === 90 ? [p.size[1], p.size[0]] : p.size;
                    const parts = p.parts?.length ? p.parts
                      : [{ kind: 'driver', label: p.label, size: body, at: [0, 0] }];
                    const frame = p.rot === 90
                      ? `translate(${x},${y + px(body[0])}) rotate(-90)`
                      : `translate(${x},${y})`;
                    return (
                      <g key={`${p.ref}-${p.slot}`}
                        className={`hub-g ${sel.includes(p.ref) ? 'is-sel' : ''} ${drag?.ref === p.ref ? 'is-dragging' : ''}`}
                        onMouseDown={(e) => {
                          setPick(null);
                          toggle(p.ref, e.shiftKey || e.metaKey || e.ctrlKey);
                          setDrag({ ref: p.ref, overBay: null, atIndex: 0 });
                        }}>
                        <g transform={frame}>
                          {parts.map((sub, n) => {
                            const sx = px(sub.at[0]);
                            const sy = px(body[1]) - px(sub.at[1]) - px(sub.size[1]);
                            const w = px(sub.size[0]);
                            const h2 = px(sub.size[1]);
                            const t = draw.labelPlan(sub.label,
                              // a junction box's "jb0" is the drawing's own
                              // bookkeeping, not an Element: size only
                              draw.subLabel(sub.kind === 'jbox' ? null : sub.ref, sub.size[0]), w, h2,
                              { base: Math.max(7, 25 * scale), min: 5 });
                            const cx = sx + w / 2;
                            const cy = sy + h2 / 2;
                            // a junction box is the drawing's own, so only the
                            // equipment says where its size came from
                            const line = sub.kind === 'jbox' ? LINE.db : LINE[p.sizedBy] ?? LINE.db;
                            const yellow = sub.kind === 'feed' || (tbc && sub.kind !== 'jbox');
                            const selected = sel.includes(p.ref);
                            return (
                              <g key={n}>
                                <rect x={sx} y={sy} width={w} height={h2}
                                  rx={sub.kind === 'driver' ? 4 : 0}
                                  fill={yellow ? `url(#yhatch-${si})` : '#fff'}
                                  strokeWidth={selected ? 2 : 1.1}
                                  {...line}
                                  {...(selected ? { stroke: '#2563eb' } : {})} />
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
                                <title>
                                  {`${sub.full ?? sub.label}${sub.kind === 'jbox' ? ''
                                    : p.sizedBy === 'datasheet' ? ' (size from the datasheet, not in the DB)'
                                      : p.sizedBy === 'edited' ? ' (size typed here, not in the DB yet)' : ''}${tbc ? ', TBC' : ''}`}
                                </title>
                              </g>
                            );
                          })}
                        </g>
                      </g>
                    );
                  })}

                  {placed.filter((p) => opt(sheet.slots[p.slot]).bounds).map((p) => {
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
        <button className="btn btn-sm btn-link p-0" onClick={() => edit({ bays: hl.rebalance(cur.bays).map(feedFirst) })}>
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
