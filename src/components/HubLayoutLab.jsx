import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveSpec } from '../engine.js';
import * as api from '../api.js';
import { effectiveDrivers, hubElements, outRef } from '../state.js';
import * as hl from '../hubLayout.js';
import * as draw from '../core/draw.js';
import { formatParams } from '../core/params.js';
import * as recipe from '../drivers/recipe.js';
import { SNAP_PRESETS, DEFAULT_SNAP, dragTo, nudge } from '../core/snap.js';
import { hubPatch } from '../drivers/hubPatch.js';
import Origin from './Origin.jsx';
import PartEditor from './PartEditor.jsx';
import ResizeIcon from './ResizeIcon.jsx';
import HubTray from './HubTray.jsx';

// Composing one PSU hub, drawn the way 5642600A draws it: equipment as plain
// labelled blocks with the drivers rounded, cable trunking hatched, Feed
// Provision hatched yellow, dimensions called out on the outside.
//
// A bay is a stack, so dragging reorders rather than positions: two blocks
// cannot overlap and the gap between neighbours is always the clearance they
// carry. The millimetres fall out of the sequence.
//
// Everything drawn here can be drawn again from only what the patch writes: each
// bay's size and start on the hub row, where every driver sits on its Element, a
// driver's parts as spaces on its wrapper type, and its junction boxes as spaces
// on the driver Element. What is not in the DB yet is outlined so: dotted for a
// datasheet figure, dashed amber for something typed here.

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

// One driver, or a Feed Provision Element, as the block the bay places.
//
// ctx: { sizes: { edited, db }, recipes, comps, types, elemParams, jbSet }
//
// A module with parts - a wrapper type with spaces, DB children, or a datasheet
// pair - is composed from those parts. Anything else is one block at its type's
// size, as it always was.
function moduleFor(driver, ctx = {}) {
  const { sizes = {}, recipes = {}, comps = {}, types = {}, elemParams = {}, jbSet = {} } = ctx;
  const spec = resolveSpec(driver.name || driver.typeName || driver.typeRef);
  const feed = hl.isFeed(driver.typeRef);
  const storedJb = jbSet[driver.ref] ?? recipe.jbCount(elemParams[driver.ref]);
  const jbAuto = feed ? 0 : defaultJboxes(spec, driver);
  const n = feed ? 0 : storedJb ?? jbAuto;
  const base = {
    ref: driver.ref, typeRef: driver.typeRef, label: driver.typeRef,
    kind: feed ? 'feed' : 'module', jboxes: n, jbStored: storedJb != null, jbAuto,
    // one upright module to a row: see packSlot in core/layout.js
    alone: true,
  };

  if (!feed) {
    const typed = recipes[`@${driver.ref}`] ?? null;
    const own = recipe.fromParams(elemParams[driver.ref]);
    const r = !typed && own.length
      ? { source: 'element', parts: own }
      : recipe.partsFor({
        wrapper: {
          typeRef: driver.typeRef,
          name: types[driver.typeRef]?.name || driver.typeName || driver.name,
          params: types[driver.typeRef]?.params,
        },
        children: comps[driver.typeRef] ?? [],
        types,
        resolveSpec,
        edited: typed ?? recipes[driver.typeRef] ?? null,
      });
    if (r.source !== 'wrapper' && r.parts.some((p) => p.size)) {
      // an arrangement nobody has stated lifts the supply over the junction boxes
      if (r.source === 'children' || r.source === 'suggested') {
        r.parts = recipe.houseArrange(r.parts, { minLow: n * recipe.JB_SIZE[1] });
      }
      const built = recipe.compose(r.parts, n);
      const origin = r.source === 'edited' ? 'edited'
        : (r.source === 'spaces' || r.source === 'element') ? 'db' : 'datasheet';
      return {
        ...base,
        recipe: { ...r, scope: typed ? 'element' : 'type' },
        sizedBy: built ? origin : 'missing',
        missing: r.parts.filter((p) => !p.size).map((p) => p.label ?? p.typeRef ?? p.space),
        size: built?.size ?? null,
        parts: built?.parts ?? [],
      };
    }
  }

  const part = spec?.driver ?? spec ?? null;
  const label = feed ? 'Feed Provision' : part?.code ?? part?.name ?? driver.typeRef;
  const sheet = feed
    ? [{ kind: 'feed', label, size: hl.FEED_SIZE, full: `${driver.typeRef}, no size stated` }]
    : [{ kind: 'driver', label, size: part?.sizeMm ?? null, full: part?.name ?? driver.typeRef }];
  const { size: stated, origin } = hl.resolveSize({
    edited: sizes.edited?.[driver.typeRef]?.size,
    db: sizes.db?.[driver.typeRef],
    datasheet: feed ? hl.FEED_SIZE : sheet[0].size,
  });
  const isStated = origin === 'edited' || origin === 'db';
  const body = isStated
    ? [{ kind: feed ? 'feed' : 'driver', label, size: stated,
      full: `${driver.typeRef}, sized from ${origin === 'db' ? 'its ElementType' : 'the size typed here'}` }]
    : sheet;
  const built = feed
    ? (body[0].size ? { size: body[0].size, parts: [{ ...body[0], at: [0, 0] }] } : null)
    : composite([...body, ...Array.from({ length: n }, (_, i) => JBOX(i))]);
  return {
    ...base,
    sizedBy: built ? origin : 'missing',
    missing: isStated ? [] : sheet.filter((p) => !p.size).map((p) => p.full ?? p.label),
    size: built?.size ?? null,
    parts: built?.parts ?? [],
  };
}

// Feed Provision sits at the bottom of a bay, as every hub drawing has it.
const feedFirst = (items) => [...items.filter((i) => i.kind === 'feed'), ...items.filter((i) => i.kind !== 'feed')];

const bayDefaults = () => ({
  width: null, height: null, bounds: false, target: { w: '', h: '' }, separate: false, ref: '',
});

// The outline says where a block's size came from.
const LINE = {
  db: { stroke: draw.STROKE },
  datasheet: { stroke: '#64748b', strokeDasharray: '3 2' },
  edited: { stroke: '#b7791f', strokeDasharray: '6 3' },
};

const ICON = { w: 'fit_width', h: 'height' };

// px per mm. The drawing used to be fixed at 0.36, which is small on a screen.
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 1.5;
const LEFT = 44;

// A driver module's parts and junction boxes as the spaces the patch writes.
const partsOf = (m) => (m.recipe?.parts?.length
  ? m.recipe.parts
  : m.parts.filter((p) => p.kind !== 'jbox').map((p) => ({ role: 'Driver', size: p.size, at: [p.at?.[0] ?? 0, p.at?.[1] ?? 0, 0] })));

export default function HubLayoutLab({ state, dispatch, zone = null, onBack = null }) {
  const { model, addedDrivers } = state;
  const effective = useMemo(
    () => effectiveDrivers(model, addedDrivers, state.deletedDrivers),
    [model, addedDrivers, state.deletedDrivers],
  );
  // what the workbook already states
  const stated = useMemo(() => api.typeSizes(), [model]);
  const dbTbc = useMemo(() => api.tbcFlags(), [model]);
  const typesLib = useMemo(() => api.typeInfo(), [model]);
  const comps = useMemo(() => api.compositions(), [model]);
  const rows = useMemo(() => api.hubRows(), [model]);
  // and everything else the hub holds, which the driver form never mentioned
  const hubLabel = zone ?? state.context?.hubLabel ?? model.zones[0];
  const drivers = useMemo(
    () => [...effective, ...hubElements(model, effective, rows, hubLabel)],
    [effective, model, rows, hubLabel],
  );
  const elemParams = useMemo(() => Object.fromEntries(Object.values(rows.elements)
    .map((e) => [e.ref, e.parameters])), [rows]);
  const sizes = useMemo(() => ({ edited: state.typeSizes ?? {}, db: stated }), [state.typeSizes, stated]);
  const ctx = useMemo(() => ({
    sizes, recipes: state.recipes ?? {}, comps, types: typesLib, elemParams, jbSet: state.jboxes ?? {},
  }), [sizes, state.recipes, comps, typesLib, elemParams, state.jboxes]);
  // a row with a Quantity, until it has been broken apart
  const brokenFrom = useMemo(() => new Set(addedDrivers.filter((a) => a.split).map((a) => a.split)), [addedDrivers]);
  const qtyOf = (ref) => (brokenFrom.has(ref) ? 1 : rows.elements[ref]?.quantity ?? 1);
  const stackFor = (d) => hl.stack(moduleFor(d, ctx), qtyOf(d.ref));
  const snap = state.prefs?.snapMm > 0 ? state.prefs.snapMm : DEFAULT_SNAP;

  const hubs = model.zones;
  const [hub, setHub] = useState(hubs.includes(zone) ? zone : hubs[0] ?? null);
  const [st, setSt] = useState({});
  const [sel, setSel] = useState([]);
  const [drag, setDrag] = useState(null);
  const [hist, setHist] = useState({ undo: [], redo: [] });
  const [scale, setScale] = useState(0.55);
  const [menu, setMenu] = useState(null);         // bay index whose menu is open
  const [copied, setCopied] = useState(false);
  // the editor is opened on purpose, from a block's pencil or a sizeless type in
  // the legend, and floats under what opened it: { ref?, typeRef?, sheet?, x?, y? }
  const [editing, setEditing] = useState(null);
  const [draft, setDraft] = useState(null);       // { typeRef, w, h, d } in the size editor
  const [skip, setSkip] = useState([]);           // typeRefs left out of the patch
  const [hover, setHover] = useState(null);       // bay under the pointer, for its handles
  const [resize, setResize] = useState(null);     // a bay edge being pulled
  const [exact, setExact] = useState(null);       // a dimension being typed in place
  const [shake, setShake] = useState(null);       // a bay refusing a height below its contents
  const [snapOpen, setSnapOpen] = useState(false);
  const [nudgeAt, setNudgeAt] = useState(null);   // { b, axis } the arrow keys move
  const [notice, setNotice] = useState(null);
  const svgEls = useRef({});
  const sheetGeo = useRef({});   // each sheet's bays and offsets, for finding a drop
  const trayEl = useRef(null);
  const menuEl = useRef(null);
  const resizeRef = useRef(null);
  resizeRef.current = resize;
  const px = (n) => n * scale;

  const cur = st[hub] ?? null;

  // A hub opens as the DB last saved it: the hub row's bays, and each Element
  // where its ContextParameters put it. Anything with no placement waits in the
  // tray, so a hub nobody has laid out opens with empty bays and a full tray.
  useEffect(() => {
    if (!hub || st[hub]) return;
    const mine = drivers.filter((d) => d.zone === hub);
    const items = mine.map((d) => stackFor(d));
    const placed = mine.map((d) => rows.elements[d.ref]).filter((e) => /[<[]/.test(e?.contextParameters ?? ''));
    if (rows.hub?.parameters || placed.length || rows.bays.length) {
      const byRef = Object.fromEntries(items.map((i) => [i.ref, i]));
      const stored = hl.loadLayout({
        container: rows.hub?.parameters ?? '',
        slots: rows.bays.map((b) => ({ ref: b.ref, name: b.name, parameters: b.parameters })),
        elements: placed,
      }, byRef);
      const done = new Set(stored.slots.flat().map((i) => i.ref));
      const tray = feedFirst(items.filter((i) => !done.has(i.ref)));
      const opts = stored.slots.map((_, i) => ({
        ...bayDefaults(),
        width: stored.widths[i] ?? null,
        height: stored.heights[i] ?? null,
        separate: stored.separate.includes(i),
        ref: stored.refs[i] ?? '',
      }));
      // it opens in whichever form the DB holds it: enclosure Elements, or spaces
      setSt((s) => ({ ...s, [hub]: { bays: stored.slots, opts, tray, enclosures: stored.enclosures, fromDb: true } }));
      return;
    }
    // Nothing stored for this hub: the drivers the data recognises are placed
    // straight away, to save picking them one by one; provisions and anything it
    // does not recognise wait in the tray. Placed here is not placed in the DB -
    // the legend counts them until the patch writes them.
    const known = (i) => hl.isKnownDriver(mine.find((d) => d.ref === i.ref));
    setSt((s) => ({ ...s, [hub]: {
      bays: [items.filter(known)], opts: [bayDefaults()], tray: feedFirst(items.filter((i) => !known(i))),
    } }));
  }, [hub, drivers, st, ctx, rows]);

  // A size, a part arrangement or a junction box count belongs to the set, so a
  // change redraws every Element it reaches in every hub already open. Not an
  // undo step: it is the set's, like a preset.
  useEffect(() => {
    setSt((s) => Object.fromEntries(Object.entries(s).map(([h, v]) => {
      const alive = (i) => drivers.some((x) => x.ref === i.ref);   // not an undone split
      const redraw = (i) => ({ ...stackFor(drivers.find((x) => x.ref === i.ref)), rot: i.rot });
      const bays = v.bays.map((b) => b.filter(alive).map(redraw));
      const tray = (v.tray ?? []).filter(alive).map(redraw);
      // Drivers broken out of a quantity stand just after the row they came from,
      // in a bay or in the tray; anything else new waits in the tray.
      const have = new Set([...bays.flat(), ...tray].map((i) => i.ref));
      for (const d of drivers.filter((x) => x.zone === h && !have.has(x.ref))) {
        const home = (d.split && [...bays, tray].find((b) => b.some((i) => i.ref === d.split))) || tray;
        let at = -1;
        home.forEach((i, n) => { if (d.split && (i.ref === d.split || drivers.find((x) => x.ref === i.ref)?.split === d.split)) at = n; });
        home.splice(at < 0 ? home.length : at + 1, 0, stackFor(d));
      }
      return [h, { ...v, bays, tray }];
    })));
  }, [ctx, drivers, brokenFrom]);

  // the editor and the snap chip close on a click outside them
  useEffect(() => {
    if (!editing && !snapOpen) return undefined;
    // The editor is docked, so clicking the drawing or scrolling leaves it open:
    // only its own close, Escape, or another pencil changes it.
    const onDoc = (e) => { if (!e.target.closest?.('.hub-snap')) setSnapOpen(false); };
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.target.closest?.('input, select, textarea')) return;
      setEditing(null);
      setSnapOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [editing, snapOpen]);

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

  // pulling a bay edge: snapped while it moves, committed as one undo step on release
  const commitRef = useRef(null);
  useEffect(() => {
    if (!resize?.axis) return undefined;
    const move = (e) => {
      const r = resizeRef.current;
      if (!r) return;
      const mods = { alt: e.altKey, shift: e.shiftKey };
      const dx = (e.clientX - r.x0) / scale;
      const dy = (r.y0 - e.clientY) / scale;
      setResize({
        ...r, mx: e.clientX, my: e.clientY,
        w: r.axis === 'h' ? r.startW : dragTo(r.startW, dx, snap, mods, { min: r.minW }),
        h: r.axis === 'w' ? r.startH : dragTo(r.startH, dy, snap, mods, { min: 0 }),
      });
    };
    const up = () => { const r = resizeRef.current; setResize(null); if (r) commitRef.current?.(r); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [resize?.axis, resize?.b]);

  // Arrow keys move whichever bay edge was last grabbed or focused. An SVG handle
  // is not reliably focused by a click, so the keys are heard on the window.
  const keyRef = useRef(null);
  useEffect(() => {
    if (!nudgeAt) return undefined;
    const onKey = (e) => {
      if (e.target.closest?.('input, select, textarea')) return;
      if (e.key === 'Escape') { setNudgeAt(null); return; }
      keyRef.current?.(e, nudgeAt.b, nudgeAt.axis);
    };
    const onDown = (e) => { if (!e.target.closest?.('.hub-handle')) setNudgeAt(null); };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onDown); };
  }, [nudgeAt]);
  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(null), 3600);
    return () => clearTimeout(t);
  }, [notice]);

  const usedBy = (typeRef) => [...model.drivers, ...addedDrivers].filter((d) => d.typeRef === typeRef).length;

  // one type per hub, sized with no junction boxes: what its ElementType states
  const hubDrivers = drivers.filter((d) => d.zone === hub);
  const types = [...new Map(hubDrivers.map((d) => [d.typeRef, moduleFor(d, { ...ctx, jbSet: { [d.ref]: 0 } })])).values()];

  // Every driver type in the set, not only this hub's. A size belongs to the
  // type, and the spec patch already writes every type it can, so the size patch
  // does the same: opening one hub is not a reason to leave the others unsized.
  const setTypes = [...new Map([
    ...drivers.map((d) => [d.typeRef, d]),
    ...(model.inventory ?? []).map((t) => [t.typeRef, t]),
  ]).values()].map((t) => {
    const ref = `__type:${t.typeRef}`;
    return moduleFor(
      { ref, typeRef: t.typeRef, name: t.name ?? '', typeName: t.typeName ?? t.name ?? '', powerType: t.powerType, nodes: t.nodes },
      { ...ctx, jbSet: { [ref]: 0 } },
    );
  });

  // the editor follows the block whose pencil was pressed, or the sizeless type
  // picked from the legend, since that one has no block to press
  const focusItem = editing?.ref ? cur?.bays.flat().find((i) => i.ref === editing.ref) : null;
  const focusType = focusItem?.typeRef ?? editing?.typeRef ?? null;
  const focusModule = focusItem ?? types.find((m) => m.typeRef === focusType) ?? null;
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
  // a feed with no size of its own spans its bay instead of deciding its width
  const laid = cur.bays.map((b, i) => hl.spanFeeds(b, opt(i).width));
  // a bay nobody has given a width is as wide as what it holds, so the far
  // trunking sits against the equipment
  const widthOf = (b) => (opt(b).width > 0 ? opt(b).width : hl.naturalWidth(laid[b]));
  const contentH = (b, w = widthOf(b)) => hl.bayHeight(laid[b], w);
  const heightOf = (b) => Math.max(contentH(b), opt(b).height > 0 ? opt(b).height : 0);
  const separate = cur.opts.map((o, i) => (o.separate ? i : null)).filter((i) => i != null);

  // One column's width: what the bay holds, with a sizeless feed spanning it
  // rather than holding it open. Measuring with the feed already stretched to the
  // current width is what stopped a bay with a feed ever getting narrower.
  const colWidth = (b) => (cur.bays[b].length ? hl.naturalWidth(hl.spanFeeds(cur.bays[b], null)) : 2 * hl.TRUNK + 50);

  // How many bays a width would make. A bay is one column of upright modules;
  // pulling it past room for a second column makes a second bay with its own
  // trunking, instead of packing two columns whose clearances overlap.
  const baysFor = (b, w) => {
    const loose = cur.bays[b].filter((i) => i.kind !== 'feed');
    if (loose.filter((i) => i.rot !== 90).length < 2) return 1;
    return Math.max(1, Math.min(loose.length, Math.floor(w / colWidth(b))));
  };
  const splitWide = (b, w) => {
    const k = baysFor(b, w);
    if (k < 2) return false;
    const items = cur.bays[b];
    const feeds = items.filter((i) => i.kind === 'feed');
    const loose = items.filter((i) => i.kind !== 'feed');
    const per = Math.ceil(loose.length / k);
    const chunks = Array.from({ length: k }, (_, j) => loose.slice(j * per, (j + 1) * per)).filter((c) => c.length);
    chunks[0] = [...feeds, ...chunks[0]];
    const o = opt(b);
    edit({
      bays: [...cur.bays.slice(0, b), ...chunks, ...cur.bays.slice(b + 1)],
      opts: [...cur.opts.slice(0, b),
        ...chunks.map((_, j) => ({ ...o, width: null, height: j === 0 ? o.height : null,
          separate: j === 0 ? o.separate : false, ref: j === 0 ? o.ref : '' })),
        ...cur.opts.slice(b + 1)],
    });
    setNotice(`Bay ${b + 1} holds one column of drivers, so it became ${chunks.length} bays, each with its own trunking.`);
    return true;
  };

  // a height at or below the contents is no height at all: the contents decide
  const commitBay = (r) => {
    if (r.axis !== 'h' && splitWide(r.b, r.w)) return;
    const patch = {};
    if (r.axis !== 'h') patch.width = r.w;
    if (r.axis !== 'w') {
      const floor = contentH(r.b, patch.width ?? widthOf(r.b));
      patch.height = r.h > floor ? r.h : null;
      if (r.h < floor) { setShake(r.b); setTimeout(() => setShake(null), 420); }
    }
    setOpt(r.b, patch);
  };
  commitRef.current = commitBay;

  const startResize = (e, b, axis, si) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = svgEls.current[`s${si}`]?.getBoundingClientRect() ?? { left: 0, top: 0 };
    const w = widthOf(b);
    setResize({
      b, axis, si, x0: e.clientX, y0: e.clientY, mx: e.clientX, my: e.clientY, rx: rect.left, ry: rect.top,
      startW: w, startH: heightOf(b), w, h: heightOf(b),
      minW: colWidth(b),
    });
  };
  const keyResize = (e, b, axis) => {
    const shift = e.shiftKey;
    if ((axis === 'w' || axis === 'both') && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      e.preventDefault();
      const next = nudge(widthOf(b), e.key === 'ArrowRight' ? 1 : -1, snap, { shift, min: colWidth(b) });
      if (!splitWide(b, next)) setOpt(b, { width: next });
    } else if ((axis === 'h' || axis === 'both') && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const next = nudge(heightOf(b), e.key === 'ArrowUp' ? 1 : -1, snap, { shift });
      commitBay({ b, axis: 'h', h: next });
    }
  };
  keyRef.current = keyResize;
  const openExact = (e, b, axis, si) => {
    e.stopPropagation();
    const rect = svgEls.current[`s${si}`]?.getBoundingClientRect() ?? { left: 0, top: 0 };
    setExact({ b, axis, si, x: e.clientX - rect.left - 30, y: e.clientY - rect.top - 14,
      value: String(axis === 'w' ? widthOf(b) : heightOf(b)) });
  };
  const commitExact = () => {
    const n = Number(exact?.value);
    if (exact && n > 0) {
      if (exact.axis === 'w') {
        const w = Math.max(n, colWidth(exact.b));
        if (!splitWide(exact.b, w)) setOpt(exact.b, { width: w });
      }
      else commitBay({ b: exact.b, axis: 'h', h: n });
    }
    setExact(null);
  };

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
  const allHeights = cur.bays.map((_, b) => (opt(b).height > 0 ? opt(b).height : 0));
  const ext = hl.extent(laid, { widths: allWidths, heights: allHeights });
  const count = (o) => types.filter((m) => m.sizedBy === o).length;
  const tbcCount = hubDrivers.filter((d) => isTbc(d.ref, d.typeRef)).length;
  // A feed with no size is drawn at a placeholder, not a datasheet figure, so it
  // is never offered to the patch: somebody has to type the real one.
  const notInDb = setTypes.filter((m) => m.size
    && (m.sizedBy === 'edited' || (m.sizedBy === 'datasheet' && m.kind !== 'feed')));
  const inPatch = notInDb.filter((m) => !skip.includes(m.typeRef));

  // Each piece's enclosure Ref lives on its first bay; enclosures the DB holds that
  // the patch would no longer use are marked deleted, and said so before copying.
  const allPieces = hl.pieces(cur.bays.length, separate);
  const pieceRefs = Object.fromEntries(allPieces
    .map((pc) => [pc.group, (opt(pc.slots[0]).ref ?? '').trim() || null])
    .filter(([, r]) => r));
  const keepRefs = new Set(cur.enclosures ? Object.values(pieceRefs) : []);
  const dropEnclosures = rows.bays.map((b) => b.ref).filter((r) => !keepRefs.has(r));

  const toggle = (ref, add) => setSel((c) => (add
    ? (c.includes(ref) ? c.filter((r) => r !== ref) : [...c, ref])
    : (c.includes(ref) && c.length === 1 ? [] : [ref])));

  const tray = cur.tray ?? [];

  // Which bay, and where in it, a point on screen falls. Worked out from the point
  // itself, so a drop lands where it is released whether or not the drawing saw
  // the pointer move on the way there.
  const hitBay = (x, y) => {
    for (const [si, g] of Object.entries(sheetGeo.current)) {
      const el = svgEls.current[`s${si}`];
      if (!el || !g) continue;
      const r = el.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      const mmX = (x - r.left - LEFT) / scale;
      let local = g.off.findIndex((o0, i) => mmX >= o0 && mmX < o0 + g.widths[i]);
      if (local < 0) local = mmX < 0 ? 0 : g.bays.length - 1;
      const mmY = (r.top + 10 + g.H - y) / scale;
      return { overBay: g.slots[local], atIndex: hl.dropIndex(g.bays[local], mmY, { slotWidth: g.widths[local] }) };
    }
    return null;
  };

  const onDrop = (e) => {
    const t = trayEl.current?.getBoundingClientRect();
    const onTray = !!(drag && e && t && e.clientX >= t.left && e.clientX <= t.right && e.clientY >= t.top && e.clientY <= t.bottom);
    const hit = drag && e && !onTray ? hitBay(e.clientX, e.clientY) : null;
    const d = drag && { ...drag, overTray: onTray, overBay: hit ? hit.overBay : null, atIndex: hit ? hit.atIndex : 0 };
    if (d?.fromTray && d.overBay != null) {
      const item = tray.find((i) => i.ref === d.ref);
      if (item) {
        edit({
          tray: tray.filter((i) => i.ref !== d.ref),
          bays: cur.bays.map((b, i) => (i === d.overBay ? [...b.slice(0, d.atIndex), item, ...b.slice(d.atIndex)] : b)),
        });
      }
    } else if (d?.overTray && !d.fromTray) {
      const item = cur.bays.flat().find((i) => i.ref === d.ref);
      if (item) edit({ bays: cur.bays.map((b) => b.filter((i) => i.ref !== d.ref)), tray: [...tray, item] });
    } else if (d?.overBay != null && !d.fromTray) {
      edit({ bays: hl.moveItem(cur.bays, d.ref, d.overBay, d.atIndex) });
    }
    setDrag(null);
  };

  // junction boxes are the Element's, so they go through the set's state and the patch
  const setJboxes = (refs, n) => refs.forEach((ref) => dispatch({ type: 'SET_JBOXES', ref, count: n }));

  const breakApart = (ref) => {
    const item = [...cur.bays.flat(), ...(cur.tray ?? [])].find((i) => i.ref === ref);
    const d = drivers.find((x) => x.ref === ref);
    if (!item || !d || !(item.qty > 1)) return;
    dispatch({ type: 'SPLIT_QUANTITY', ref, typeRef: d.typeRef, zone: hub, quantity: item.qty });
    setNotice(`${outRef(ref)} is now ${item.qty} drivers: it keeps its Ref, the other ${item.qty - 1} need Refs in the DB.`);
  };

  const addBay = () => edit({ bays: hl.addBay(cur.bays), opts: [...cur.opts, bayDefaults()] });
  const removeBay = () => edit({ bays: hl.removeBay(cur.bays), opts: cur.opts.slice(0, -1) });
  const splitSelected = () => {
    edit({ bays: hl.splitToBay(cur.bays, sel), opts: [...cur.opts, bayDefaults()] });
    setSel([]);
  };

  // ---- the patch --------------------------------------------------------------
  // Every bay's size and start, where each driver sits, separated bays, sizes and
  // part arrangements not in the DB yet (unless left out), junction boxes set
  // here, and TBC flags.
  const copyPatch = async () => {
    const ctxHub = state.context;
    const container = ctxHub?.hubRef
      ? { ref: ctxHub.hubRef, name: hub, contextType: ctxHub.hubContextType ?? 'Position' }
      : { name: hub };
    const saved = hl.save(laid, {
      container, separate, widths: allWidths, heights: allHeights,
      enclosures: !!cur.enclosures, pieceRefs,
    });
    const fmtSize = (s) => formatParams({ size: [s[0], s[1], s[2] > 0 ? s[2] : null] });

    const typeRows = new Map();
    for (const m of inPatch) {
      if (m.recipe && m.recipe.source !== 'spaces' && m.recipe.source !== 'element' && m.recipe.scope !== 'element') {
        // a wrapper: its parts as spaces, its envelope as its size, and each
        // child type's own size where the DB does not have it
        const env = recipe.envelope(m.recipe.parts);
        typeRows.set(m.typeRef, { ref: m.typeRef, size: env ? fmtSize(env) : '',
          spaces: formatParams({ spaceList: recipe.toSpaceList(m.recipe.parts) }) });
        for (const p of m.recipe.parts) {
          if (p.typeRef && p.size && p.sizeOrigin !== 'db' && !typeRows.has(p.typeRef)) {
            typeRows.set(p.typeRef, { ref: p.typeRef, size: fmtSize(p.size) });
          }
        }
      } else if (!m.recipe) {
        typeRows.set(m.typeRef, { ref: m.typeRef, size: fmtSize(m.size) });
      }
    }

    // an Element's own spaces: its parts when they were arranged for it alone,
    // and its junction boxes when they were set here
    const jb = {};
    for (const d of hubDrivers) {
      const m = moduleFor(d, ctx);
      const ownParts = m.recipe?.scope === 'element' ? m.recipe.parts : [];
      const setHere = state.jboxes?.[d.ref] != null;
      if (!ownParts.length && !setHere) continue;
      const list = [...recipe.toSpaceList(ownParts), ...recipe.placeJbs(m.jboxes, partsOf(m))];
      jb[d.ref] = list.length ? formatParams({ spaceList: list }) : '';
    }

    const mine = new Set([...hubDrivers.map((d) => d.ref), ...types.map((m) => m.typeRef)]);
    const tbc = Object.entries(state.tbc ?? {})
      .filter(([ref]) => mine.has(ref))
      .map(([ref, f]) => ({ ...f, ref: f.sheet === 'E' ? outRef(ref) : ref }));
    // a quantity broken apart: the row keeps one, the rest are appended where placed
    const broken = addedDrivers.filter((a) => a.split && a.zone === hub);
    const quantities = [...new Set(broken.map((a) => a.split))].map((ref) => ({ ref: outRef(ref), quantity: 1 }));
    const newElements = Object.fromEntries(broken.map((a) => [a.ref, { typeRef: a.typeRef, name: typesLib[a.typeRef]?.name ?? '' }]));
    const unplaced = tray.filter((i) => /[<[]/.test(rows.elements[i.ref]?.contextParameters ?? '')).map((i) => i.ref);
    await api.copyPatch(hubPatch({
      saved, hub: container.ref ? container : null, typeSizes: [...typeRows.values()], tbc, jb, quantities, newElements, unplaced,
      dropEnclosures,
    }));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const focusTbc = focusModule && isTbc(focusRef, focusType);


  const flagBlock = focusModule ? (
    <>
    {focusItem?.qty > 1 && (
      <div className="hub-qty">
        <span><b>{outRef(focusItem.ref)}</b> is one row standing for {focusItem.qty} drivers. It moves as one stack.</span>
        <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => breakApart(focusItem.ref)}>
          Break apart into {focusItem.qty}
        </button>
      </div>
    )}
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
    </>
  ) : null;

  // a module with parts gets the part editor; a single block gets its size
  const inspector = !focusModule ? null : focusModule.recipe ? (
    <PartEditor key={`${focusType}|${focusRef}|${focusModule.recipe.source}`}
      module={focusModule}
      elementLabel={focusRef ? outRef(focusRef) : 'this Element'}
      usedBy={usedBy(focusType)}
      typeNames={Object.keys(typesLib)}
      snap={snap}
      jboxes={focusModule.jboxes} jbStored={focusModule.jbStored} jbAuto={focusModule.jbAuto}
      onJboxes={(n) => focusRef && setJboxes([focusRef], n)}
      onSave={(parts, scope) => dispatch({ type: 'SET_RECIPE', typeRef: scope === 'element' ? `@${focusRef}` : focusType, parts })}
      onClose={() => setEditing(null)}>
      {flagBlock}
    </PartEditor>
  ) : draft?.typeRef === focusType ? (
    <div className="hub-inspect">
      <div className="hub-inspect-head">
        <b className="rv-ref">{focusType}</b>
        {focusModule.sizedBy !== 'db' && <Origin kind={focusModule.sizedBy} what={`${focusType}'s size`} />}
        {focusTbc && <Origin kind="tbc" what={focusType} />}
        <button type="button" className="btn-close ms-auto" aria-label="Close"
          onClick={() => setEditing(null)} />
      </div>
      <div className="hub-sizes">
        {['w', 'h', 'd'].map((k) => (
          <label key={k} className="fld">
            <span className="fld-col">{k}</span>
            <span className="fld-box">
              <input type="number" step={snap} style={{ width: 64 }} value={draft[k]}
                onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />mm
            </span>
          </label>
        ))}
        <button type="button" className="btn btn-sm btn-primary" disabled={!(+draft.w > 0 && +draft.h > 0)}
          onClick={() => dispatch({ type: 'SET_TYPE_SIZE', typeRef: focusType,
            size: [+draft.w, +draft.h, +draft.d > 0 ? +draft.d : 0] })}>
          Save to type ({usedBy(focusType)})
        </button>
        {state.typeSizes?.[focusType] && (
          <button type="button" className="btn btn-sm btn-outline-secondary"
            onClick={() => dispatch({ type: 'SET_TYPE_SIZE', typeRef: focusType, size: null })}>
            Back to the {stated[focusType] ? 'DB' : 'datasheet'} size
          </button>
        )}
      </div>
      {focusModule.kind !== 'feed' && focusRef && (
        <span className="hub-bays">
          junction boxes on {outRef(focusRef)}
          <button type="button" className={focusModule.jbStored ? '' : 'is-on'} onClick={() => setJboxes([focusRef], null)}>auto {focusModule.jbAuto}</button>
          {[0, 1, 2, 3, 4].map((n) => (
            <button type="button" key={n} className={focusModule.jbStored && focusModule.jboxes === n ? 'is-on' : ''}
              onClick={() => setJboxes([focusRef], n)}>{n}</button>
          ))}
        </span>
      )}
      {flagBlock}
      <div className="text-secondary small">
        A size belongs to the type, so it applies to every {focusType} in the set.
        {focusModule.missing.length > 0 && ` No datasheet size for ${focusModule.missing.join(', ')}.`}
      </div>
    </div>
  ) : null;

  const bayHandle = (b, axis, cx, cy, si) => (
    <g key={axis} className={`hub-handle ${nudgeAt?.b === b && nudgeAt.axis === axis ? 'is-armed' : ''}`}
      transform={`translate(${cx},${cy})`} tabIndex={0} role="button"
      aria-label={`Bay ${b + 1} ${axis === 'w' ? 'width' : axis === 'h' ? 'height' : 'width and height'}`}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => { setNudgeAt({ b, axis }); startResize(e, b, axis, si); }}
      onFocus={() => setNudgeAt({ b, axis })}
      onDoubleClick={(e) => openExact(e, b, axis === 'h' ? 'h' : 'w', si)}>
      <title>
        {`Drag to set bay ${b + 1}'s ${axis === 'w' ? 'width' : axis === 'h' ? 'height' : 'width and height'}`
          + ` on a ${snap}mm snap (Alt 1mm, Shift ${snap * 5}mm). Arrow keys nudge, double-click to type.`}
      </title>
      <circle r="11" />
      <ResizeIcon name={ICON[axis]} size={14} x={-7} y={-7} />
    </g>
  );

  return (
    <div className={`container-fluid py-3 hub-lab ${editing && inspector ? 'has-dock' : ''}`}
      onMouseUp={onDrop} onMouseLeave={() => setDrag(null)}>
      {/* one editor at a time, docked where it is always on screen */}
      {editing && inspector && (
        <aside className="hub-dock" aria-label="Editor">{inspector}</aside>
      )}
      <div className="dp-head">
        {onBack && (
          <button className="btn btn-sm btn-outline-secondary d-flex align-items-center"
            onClick={onBack} title="Back to assigning this hub">
            <span className="material-icons small-icon">arrow_back</span> Assign
          </button>
        )}
        <select className="form-select form-select-sm" style={{ width: 'auto' }} value={hub}
          onChange={(e) => {
            setHub(e.target.value); setSel([]); setEditing(null); setMenu(null); setHist({ undo: [], redo: [] });
          }}>
          {hubs.map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
        <h5 className="mb-0 hub-dim">{ext.w} × {ext.h} × {hl.DEPTH_MM}mm</h5>
        <span className="hub-zoom" title="Zoom">
          <button onClick={() => setScale((z) => Math.max(ZOOM_MIN, +(z - 0.1).toFixed(2)))} aria-label="Zoom out">-</button>
          <span>{Math.round((scale / 0.36) * 100)}%</span>
          <button onClick={() => setScale((z) => Math.min(ZOOM_MAX, +(z + 0.1).toFixed(2)))} aria-label="Zoom in">+</button>
        </span>
        <span className="hub-snap">
          <button type="button" className="hub-snap-chip" onClick={() => setSnapOpen((o) => !o)}
            aria-expanded={snapOpen} title="Resize grid">
            snap {snap}mm <span className="material-icons small-icon">expand_more</span>
          </button>
          {snapOpen && (
            <div className="hub-snap-pop">
              <div className="hub-snap-presets">
                {SNAP_PRESETS.map((v) => (
                  <button type="button" key={v} className={v === snap ? 'is-on' : ''}
                    onClick={() => dispatch({ type: 'SET_PREFS', prefs: { snapMm: v } })}>{v}</button>
                ))}
                <label className="hub-snap-custom">
                  <input type="number" min="0.5" step="0.5" value={snap}
                    onChange={(e) => +e.target.value > 0 && dispatch({ type: 'SET_PREFS', prefs: { snapMm: +e.target.value } })} />mm
                </label>
              </div>
              <div className="text-secondary small">Alt for 1mm, Shift for {snap * 5}mm, arrow keys nudge.</div>
            </div>
          )}
        </span>
        <div className="hub-controls">
          <span className="hub-bays">
            bays
            <button disabled={cur.bays.length <= 1} onClick={removeBay}>−</button>
            {cur.bays.length}
            <button onClick={addBay}>+</button>
          </span>
          <label className="hub-check" title="One ET-PSU-ENC Element per piece of joinery, with its drivers inside. Off: pieces are recorded as space groups on the hub row.">
          <input type="checkbox" checked={!!cur.enclosures} onChange={() => edit({ enclosures: !cur.enclosures })} /> Enclosure Elements
        </label>
        {dropEnclosures.length > 0 && (
          <span className="hub-verdict is-over" title="Their drivers are moved back onto the hub first">
            patch marks {dropEnclosures.length} enclosure{dropEnclosures.length === 1 ? '' : 's'} IsDeleted
          </span>
        )}
        <button className="btn btn-sm btn-link p-0" onClick={() => {
            // everything, the tray included
            const all = cur.bays.map((b, i) => (i === 0 ? [...b, ...tray] : b));
            edit({ bays: hl.rebalance(all).map(feedFirst), tray: [] });
          }}>
            Auto-arrange
          </button>
          {sel.length > 0 && (
            <>
              <span className="hub-bays">
                junction boxes
                {/* one per output on CV and none on CC to start, reduced from there */}
                <button onClick={() => setJboxes(sel, null)} title="Back to one per output on CV, none on CC">auto</button>
                {[0, 1, 2, 3, 4].map((n) => (
                  <button key={n} onClick={() => setJboxes(sel, n)}>{n}</button>
                ))}
              </span>
              <button className="btn btn-sm btn-outline-secondary"
                onClick={() => edit({ bays: sel.reduce((bs, r) => hl.rotate(bs, r), cur.bays) })}
                title="Stand it on its side, as HUB-A does across its top zone">
                Rotate 90°
              </button>
              {sel.map((r) => cur.bays.flat().find((i) => i.ref === r)).filter((i) => i?.qty > 1).map((i) => (
              <button key={i.ref} className="btn btn-sm btn-outline-primary" onClick={() => breakApart(i.ref)}>
                Break apart {outRef(i.ref)} ×{i.qty}
              </button>
            ))}
            <button className="btn btn-sm btn-outline-primary" onClick={splitSelected}>
                Split {sel.length} into a new bay
              </button>
            </>
          )}
        </div>
        {notice && <span className="hub-notice" role="status">{notice}</span>}
        {cur.fromDb && <span className="hub-fromdb" title="Opened from the bays and placements the DB holds">from the DB</span>}
        <span className="ms-auto d-flex align-items-center gap-2">
          {notInDb.length > 0 && (
            <details className="hub-inpatch">
              <summary>{inPatch.length} of {notInDb.length} types in the set not in the DB go in the patch</summary>
              <div className="hub-inpatch-list">
                {notInDb.map((m) => (
                  <label key={m.typeRef}>
                    <input type="checkbox" checked={!skip.includes(m.typeRef)}
                      onChange={() => setSkip((s) => (s.includes(m.typeRef)
                        ? s.filter((x) => x !== m.typeRef) : [...s, m.typeRef]))} />
                    <span className="rv-ref">{m.typeRef}</span>
                    <span className="text-secondary">{m.recipe ? `${m.recipe.parts.length} parts` : formatParams({ size: m.size })}</span>
                    <Origin kind={m.sizedBy} what={m.typeRef} />
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
            title="Copy an ExcelScript patch: bays, positions, separated bays, parts, junction boxes, sizes not in the DB and TBC flags">
            <span className="material-icons small-icon align-middle">{copied ? 'check' : 'content_copy'}</span>
            {copied ? ' Copied' : ' Copy patch'}
          </button>
          <span className="badge text-bg-warning">lab</span>
        </span>
      </div>

      {/* what in this hub is the DB's, and what the tool is standing in for */}
      <div className="hub-legend">
        <span>{types.length} type{types.length === 1 ? '' : 's'}:</span>
        {tray.length > 0 && <span>{tray.reduce((n, i) => n + (i.qty ?? 1), 0)} not placed</span>}
        {/* placed in this drawing but not yet in the DB, which only knows a
            placement once the patch writes its <space> */}
        {(() => {
          const pending = cur.bays.flat().filter((i) => !/</.test(rows.elements[i.ref]?.contextParameters ?? ''));
          return pending.length > 0 && (
            <span><Origin kind="edited" what="These placements" />{pending.length} placed, not in the DB yet</span>
          );
        })()}
        {count('db') > 0 && <span>{count('db')} sized in the DB</span>}
        {count('datasheet') > 0 && <span><Origin kind="datasheet" what="These sizes" />{count('datasheet')}</span>}
        {count('edited') > 0 && <span><Origin kind="edited" what="These sizes" />{count('edited')}</span>}
        {tbcCount > 0 && <span><Origin kind="tbc" what="These Elements" />{tbcCount}</span>}
        {types.filter((m) => m.sizedBy === 'missing').map((m) => (
          <button key={m.typeRef} type="button" className="btn btn-sm btn-link p-0"
            onClick={() => setEditing({ typeRef: m.typeRef })}
            title="Give this type a size">
            <Origin kind="missing" what={m.typeRef} /> {m.typeRef}
          </button>
        ))}
        <span className="text-secondary">Hover a block for its pencil, hover a bay to resize it.</span>
      </div>

      <div className="hub-body">
      <HubTray items={tray} dragging={drag} trayRef={trayEl}
        onPick={(ref) => { setSel([]); setDrag({ ref, fromTray: true, overBay: null, atIndex: 0 }); }}
        onHover={(over) => setDrag((d) => (d && !d.fromTray ? { ...d, overTray: over, overBay: over ? null : d.overBay } : d))}
        onBreakApart={breakApart} />
      <div className="hub-sheets">
        {hl.sheets(cur.bays.length, separate).map((sheet, si) => {
          // Joined bays are one cabinet with a divider: they share the gap
          // between them, so the centre is 50 and not 100.
          const bays = sheet.slots.map((b) => laid[b]);
          const widths = sheet.slots.map((b) => widthOf(b));
          const heights = sheet.slots.map((b) => (opt(b).height > 0 ? opt(b).height : 0));
          const lopts = { widths, heights };
          const off = hl.offsetsOf(bays.length, lopts);
          const sheetExt = hl.extent(bays, lopts);
          const H = px(Math.max(sheetExt.h, 150));
          const W = px(sheetExt.w);
          const placed = hl.placements(bays, lopts);
          sheetGeo.current[si] = { slots: sheet.slots, off, widths, H, bays };
          // the trunking is a property of a ROW, down each side of an upright run
          // and across the ends of a turned one, and carries on up the sides to
          // the height of the tallest bay standing beside it
          const bands = bays.flatMap((items, local) =>
            hl.trunkBands(hl.packBay(items, widths[local]), widths[local], sheetExt.h)
              .map((b) => ({ ...b, x: off[local] + b.x })));
          return (
            <div key={si} className="hub-sheet">
              <div className="hub-sheet-head">
                <b>{cur.enclosures ? `${hub}.${si + 1}` : `${hub} · ${String.fromCharCode(65 + si)}`}</b>
                {cur.enclosures && (
                  <label className="hub-mrow hub-piece-ref" title="This piece's enclosure Element Ref">
                    <input type="text" placeholder="allocate" value={opt(sheet.slots[0]).ref ?? ''}
                      onChange={(e) => setOpt(sheet.slots[0], { ref: e.target.value })} />
                  </label>
                )}
                <span>{sheetExt.w} × {Math.max(sheetExt.h, 0)} × {hl.DEPTH_MM}mm</span>
              </div>

              {/* one tab over each bay, carrying that bay's own settings */}
              <div className="hub-baybar" style={{ width: W + LEFT + 16 }}>
                {sheet.slots.map((b, local) => {
                  const o = opt(b);
                  const bayExt = { w: widths[local], h: heightOf(b) };
                  const verdict = (o.target.w || o.target.h) ? hl.fitsIn(bayExt, o.target) : null;
                  // a typed width the equipment does not fit in
                  const narrow = o.width > 0 ? hl.naturalWidth(bays[local], o.width) - o.width : 0;
                  return (
                    <div key={b} className={`hub-baytab ${shake === b ? 'is-shake' : ''}`}
                      style={{ left: LEFT + px(off[local]), width: px(widths[local]) }}>
                      <span className="hub-baytab-name">bay {b + 1} · {widths[local]}{o.height > 0 ? ` × ${heightOf(b)}` : ''}</span>
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
                            <input type="number" step={snap} placeholder={String(hl.naturalWidth(laid[b]))}
                              value={o.width ?? ''}
                              onChange={(e) => setOpt(b, { width: e.target.value === '' ? null : +e.target.value })} />mm
                          </label>
                          <label className="hub-mrow" title="Blank follows what the bay holds">
                            <span>Height</span>
                            <input type="number" step={snap} placeholder={String(contentH(b))}
                              value={o.height ?? ''}
                              onChange={(e) => setOpt(b, { height: e.target.value === '' ? null : +e.target.value })} />mm
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
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="hub-stagebox">
              <svg className="hub-svg" width={W + LEFT + 16} height={H + 64}
                ref={(el) => { svgEls.current[`s${si}`] = el; }}
                onMouseLeave={() => { if (!resize) setHover(null); }}
                onMouseMove={(e) => {
                  const r = svgEls.current[`s${si}`].getBoundingClientRect();
                  const mmX = (e.clientX - r.left - LEFT) / scale;
                  let local = off.findIndex((o0, i) => mmX >= o0 && mmX < o0 + widths[i]);
                  if (!drag) {
                    const b = local < 0 ? null : sheet.slots[local];
                    if (b !== hover && !resize) setHover(b);
                    return;
                  }
                  if (local < 0) local = mmX < 0 ? 0 : bays.length - 1;
                  const y = (r.top + 10 + H - e.clientY) / scale;
                  setDrag({ ...drag, overTray: false, overBay: sheet.slots[local],
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
                  {bands.map((b, n) => (
                    // no outline, so a run of trunking reads as one band
                    <rect key={`t${n}`} className="hub-trunk" x={px(b.x)} y={H - px(b.y + b.h)} width={px(b.w)} height={px(b.h)}
                      fill={`url(#hatch-${si})`} stroke="none" />
                  ))}

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
                            // a junction box is an allowance: dotted until the
                            // Element states it, like any other stand-in
                            const line = sub.kind === 'jbox'
                              ? (p.jbStored ? LINE.db : LINE.datasheet)
                              : LINE[p.sizedBy] ?? LINE.db;
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
                                  {sub.kind === 'jbox'
                                    ? `Junction box allowance${p.jbStored ? ', stated on the Element' : ', not in the DB'}`
                                    : `${sub.full ?? sub.label}${p.sizedBy === 'datasheet' ? ' (not in the DB)'
                                      : p.sizedBy === 'edited' ? ' (set here, not in the DB yet)' : ''}${tbc ? ', TBC' : ''}`}
                                </title>
                              </g>
                            );
                          })}
                        </g>
                        {p.qty > 1 && (
                          <g className="hub-stack">
                            <rect x={x - 4} y={y - 4} width={px(p.size[0]) + 8} height={px(p.size[1]) + 8} rx="6" />
                            <text x={x + px(p.size[0]) + 8} y={y + 12}>×{p.qty}</text>
                            <title>{`${outRef(p.ref)}: one row standing for ${p.qty} drivers. Break it apart to move them one by one.`}</title>
                          </g>
                        )}
                        {/* as placed, so it stays top right when the block is turned */}
                        <g className="hub-pencil" transform={`translate(${x + px(p.size[0]) - 17},${y + 3})`}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            setEditing({ ref: p.ref });
                          }}>
                          <title>{p.recipe ? 'Parts, junction boxes and TBC' : 'Size, junction boxes and TBC'}</title>
                          <rect width="14" height="14" rx="3" />
                          <path d="M3.5 10.5 L3.5 12 L5 12 L11 6 L9.5 4.5 Z M9.5 4.5 L11 3 L12.5 4.5 L11 6" />
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

                  {/* the bay's resize handles, on hover: the ghost of where the
                      edge started stays until you let go */}
                  {sheet.slots.map((b, local) => {
                    const live = resize?.b === b;
                    if (!drag && hover !== b && !live && nudgeAt?.b !== b) return null;
                    if (drag) return null;
                    const bw = live ? resize.w : widths[local];
                    const bh = live ? resize.h : heightOf(b);
                    const x0 = px(off[local]);
                    const top = H - px(bh);
                    return (
                      <g key={`hd${b}`} className="hub-handles">
                        {live && (
                          <rect className="hub-ghost" x={x0} y={H - px(resize.startH)}
                            width={px(resize.startW)} height={px(resize.startH)} />
                        )}
                        <rect className={`hub-live ${live ? 'is-live' : ''}`} x={x0} y={top} width={px(bw)} height={px(bh)} />
                        {bayHandle(b, 'w', x0 + px(bw), top + px(bh) / 2, si)}
                        {bayHandle(b, 'h', x0 + px(bw) / 2, top, si)}
                      </g>
                    );
                  })}

                  {/* dimensions: height on the left, each bay's width under it,
                      and the overall width under that when there is more than one.
                      Double-click a figure to type it. */}
                  <g className="hub-dimline">
                    <line x1="-14" y1="0" x2="-14" y2={H} />
                    <line x1="-18" y1="0" x2="-10" y2="0" />
                    <line x1="-18" y1={H} x2="-10" y2={H} />
                    <text x="-22" y={H / 2} textAnchor="middle" transform={`rotate(-90,-22,${H / 2})`}
                      className="hub-dimval"
                      onDoubleClick={(e) => openExact(e, sheet.slots[0], 'h', si)}>
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
                          <text x={(x0 + x1) / 2} y={H + 26} textAnchor="middle" className="hub-dimval"
                            onDoubleClick={(e) => openExact(e, sheet.slots[local], 'w', si)}>{widths[local]}</text>
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
              {resize?.si === si && (() => {
                const o = opt(resize.b);
                const fits = (o.target.w || o.target.h) ? hl.fitsIn({ w: resize.w, h: resize.h }, o.target).fits : true;
                const k = resize.axis === 'w' ? baysFor(resize.b, resize.w) : 1;
                const text = resize.axis === 'w'
                  ? `${resize.startW} → ${resize.w}mm${k > 1 ? `, ${k} bays` : ''}`
                  : `${resize.startH} → ${resize.h}mm`;
                // keyed on the value, so each snap step replays the spring
                return (
                  <div key={text} className={`hub-readout ${fits ? '' : 'is-over'}`}
                    style={{ left: resize.mx - resize.rx + 16, top: resize.my - resize.ry - 36 }}>{text}</div>
                );
              })()}
              {exact?.si === si && (
                <input className="hub-exact" type="number" autoFocus step={snap} value={exact.value}
                  style={{ left: exact.x, top: exact.y }}
                  aria-label={`Bay ${exact.b + 1} ${exact.axis === 'w' ? 'width' : 'height'} in mm`}
                  onChange={(e) => setExact({ ...exact, value: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitExact(); if (e.key === 'Escape') setExact(null); }}
                  onBlur={commitExact} />
              )}
              </div>
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}
