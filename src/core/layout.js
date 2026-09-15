// Arranging items into a container's slots, and saving the arrangement to
// Parameters so it can be drawn again.
//
// A container holds numbered slots; a slot holds a stack of items laid out in
// rows. That is a PSU hub holding bays of drivers, and it is equally a lighting
// control panel holding DIN slots of modules - the DesignDB models both with the
// same `<discrete spaces>` on the parent type and `<n>` on the child.
//
// Nothing here knows which. The numbers that make a hub a hub - clearance,
// trunking width, the 380mm house bay - are options with defaults, supplied by
// whichever tool is calling. Every edit is a pure transform of a layout, so
// `node --test` covers it with no DOM.
//
// Units are millimetres throughout. Unitless in the DesignDB means mm.
import {
  mm, asMm, parseParams, formatParams,
} from './params.js';

export { mm, asMm, parseParams, formatParams, withSize, withCapacity } from './params.js';

// The clearance envelope, dimensioned against a lone SL0360A in the CAD: 50 off
// each SIDE of a part, 25 off each END. It belongs to the part and turns with
// it. These are the hub's numbers and the defaults; a caller with different
// geometry passes its own.
export const CLEAR_X = 50;
export const CLEAR_Y = 25;

// The side clearance IS the cable trunking. Drawing a wall as well as insetting
// by the clearance counts the same 50mm twice.
export const TRUNK = CLEAR_X;

// The house slot width, and the depth every hub in 5642600A is drawn at.
export const SLOT_WIDTH = 380;
export const DEPTH_MM = 150;

// Inside a composed item the parts sit against each other: the clearance is
// around the item, not between a driver and its own junction box.
export const GAP = 5;

// ---- geometry ------------------------------------------------------------
//
// A slot is a STACK, not a free surface. The drawings are columns of equipment,
// and free x/y placement meant two boxes could overlap and the spacing between
// them was whatever the mouse left behind. Stacking makes both impossible: an
// item's place is its slot and its index, its coordinates fall out of that, and
// the gap between neighbours is always exactly the clearance they each carry.
// Dragging reorders; it does not position.

// The size an item presents to the slot, turned if it is mounted on its side.
// HUB-A stands four drivers portrait across its top zone, labels turned with
// them, so rotation is a property of the item rather than of the drawing.
export const sized = (item) => {
  const s = item.size;
  if (!s) return null;
  return item.rot === 90 ? [s[1], s[0], s[2]] : s;
};

// The clearance for an item, in drawing axes. Upright, the sides are left and
// right; turned, the sides are top and bottom.
export const clearOf = (item) => (item.rot === 90
  ? { x: CLEAR_Y, y: CLEAR_X }
  : { x: CLEAR_X, y: CLEAR_Y });

// What an item actually occupies: its body plus its own clearance, turned with
// it. This is the purple rectangle.
export function footprint(item) {
  const s = sized(item);
  if (!s) return null;
  const c = clearOf(item);
  return { w: s[0] + c.x * 2, h: s[1] + c.y * 2 };
}


// Two slots standing together each keep their own trunking: the run between them
// is 100, not a shared 50. Sharing it put two bays' clearances on top of each
// other and hatched half the trunking that is really there. `joined: true` is
// kept for a caller that genuinely shares a divider.
export const pitchOf = (slotWidth, joined = false) => (joined ? slotWidth - CLEAR_X : slotWidth);

// Each slot's own width: widths[i] where one is given, else slotWidth. A hub is
// not always two identical bays - a 500 beside a 380 is ordinary joinery.
export const widthAt = (i, { slotWidth = SLOT_WIDTH, widths = null } = {}) =>
  (widths?.[i] > 0 ? widths[i] : slotWidth);

// Where each slot starts across the container: where the previous one ended,
// since each keeps its own trunking.
export function offsetsOf(count, opts = {}) {
  const joined = opts.joined ?? false;
  const out = [];
  let x = 0;
  for (let i = 0; i < count; i += 1) {
    out.push(x);
    x += widthAt(i, opts) - (joined ? CLEAR_X : 0);
  }
  return out;
}

// The width a slot has to fill, between the two trunking bands.
export const innerWidth = (slotWidth = SLOT_WIDTH) => slotWidth - 2 * TRUNK;

// A slot's stated height: more room than its contents need, as a cabinet has.
// Nothing stated is 0, and the contents decide.
export const heightAt = (i, { heights = null } = {}) => (heights?.[i] > 0 ? heights[i] : 0);

// The width a slot comes out at when nobody has typed one: its widest row plus
// that row's trunking, so the far band sits against the equipment instead of at
// 380. Rows still break at maxWidth, so a slot shrinks to what it holds and only
// grows past maxWidth when a single item is wider than the inside. Empty, it is
// the house width.
export function naturalWidth(items, maxWidth = SLOT_WIDTH) {
  const rows = packSlot(items, maxWidth);
  if (!rows.length) return maxWidth;
  return Math.round(Math.max(...rows.map((r) => r.inset * 2 + r.x)));
}

// Lay one slot out bottom-up in rows. Anything narrow enough sits BESIDE what is
// already on the row rather than starting its own - which is what the CAD does
// with four turned DualDrives across the top of HUB-A, and what a pure stack
// could never draw. A row closes when the next part will not fit the width.
//
// The 50mm clearance IS the cable trunking, and it turns with the part. So a row
// of upright parts carries the trunking down its two SIDES, and is inset 50 from
// each wall to leave room for it; a row of turned parts carries it ABOVE and
// BELOW instead, which frees the full slot width - which is exactly why HUB-A's
// four turned drivers run wall to wall while the upright run below them sits in
// a 280 column. Drawing it per part rather than per row is what chopped the
// bands into floating ghosts.
//
// Neighbours SHARE the clearance between them, the same way two slots standing
// together share a 50mm centre instead of bringing 50 each.
export function packSlot(items, slotWidth = SLOT_WIDTH) {
  const rows = [];
  let row = null;
  const close = () => { if (row?.at.length) rows.push(row); row = null; };
  for (const item of items) {
    const size = sized(item);
    if (!size) continue;
    const c = clearOf(item);
    const inset = c.x === CLEAR_X ? TRUNK : 0;
    const avail = slotWidth - inset * 2;
    // An item marked `alone` takes a row to itself unless it is turned. An
    // upright PSU-hub module carries its trunking down BOTH sides, so two of them
    // side by side would share one run nobody drew and their clearances would
    // overlap. A wider bay is more bays, not two columns in one.
    const solo = !!item.alone && item.rot !== 90;
    // a row is one orientation: the trunking cannot be down the sides and across
    // the ends of the same row
    if (row && (solo || row.solo || row.inset !== inset
      || row.x + Math.max(row.clearX, c.x) + size[0] > avail + 0.01)) close();
    if (!row) {
      row = {
        at: [], x: 0, h: 0, clearX: 0, inset, solo,
        y: rows.reduce((n, r) => n + r.h, 0),
        // the band is hatched on the edges that carry the 50
        pad: c.y, hatched: c.y === CLEAR_X,
      };
    }
    const x = row.x + (row.at.length ? Math.max(row.clearX, c.x) : 0);
    row.at.push({ item, size, clear: c, x, y: c.y });
    row.x = x + size[0];
    row.h = Math.max(row.h, size[1] + 2 * c.y);
    row.clearX = c.x;
  }
  close();
  return rows;
}

// slots: [[item, …], …] bottom-up. Returns every item with the coordinates the
// patch writes, measured from the bottom-left of the container as the schema means it.
export function placements(slots, opts = {}) {
  const off = offsetsOf(slots.length, opts);
  const out = [];
  slots.forEach((items, slot) => {
    for (const row of packSlot(items, widthAt(slot, opts))) {
      for (const a of row.at) {
        out.push({
          ...a.item, slot, size: a.size, clear: a.clear,
          x: off[slot] + row.inset + a.x, y: row.y + a.y,
        });
      }
    }
  });
  return out;
}

// How tall each slot stands on its own. A slot marked separate is its own piece of
// joinery, so it gets its own dimension rather than the container's.
export const slotHeight = (items, slotWidth = SLOT_WIDTH) =>
  Math.round(packSlot(items, slotWidth).reduce((n, r) => n + r.h, 0));

// The W x H the drawing exists to state, with the clearance inside the cabinet.
// Width is the slots: HUB-A holds a 210mm SoloDrive and is drawn 380 wide, because
// a slot is as wide as a slot whether or not anything fills it.
export function extent(slots, opts = {}) {
  const { width = null, joined = false } = opts;
  const n = Math.max(1, slots.length);
  let w = 0;
  for (let i = 0; i < n; i += 1) w += widthAt(i, opts);
  if (joined) w -= (n - 1) * CLEAR_X;
  return {
    w: Math.round(width ?? w),
    h: Math.max(0, ...slots.map((b, i) => Math.max(slotHeight(b, widthAt(i, opts)), heightAt(i, opts)))),
  };
}

// Over or under a target space, per axis. Negative is spare.
export function fitsIn(ext, target) {
  const w = mm(target?.w);
  const h = mm(target?.h);
  return {
    fits: (w == null || ext.w <= w) && (h == null || ext.h <= h),
    overW: w == null ? null : ext.w - w,
    overH: h == null ? null : ext.h - h,
  };
}

// ---- the edits -------------------------------------------------------------
// Pure transforms over slots. Every one returns new slots, so undo is a list of
// what came before and nothing has to be diffed.

// Where a drop lands: the slot under the pointer, and the index the item slots
// into judged by the midpoints of what is already there. Nothing overlaps
// because nothing is positioned - it takes a place in the order.
export function dropIndex(items, y, { slotWidth = SLOT_WIDTH } = {}) {
  const rows = packSlot(items, slotWidth);
  let i = 0;
  for (const r of rows) {
    if (y < r.y + r.h / 2) return i;
    i += r.at.length;
  }
  return items.length;
}

// Where the drop line sits. Rows are the snap: a part lands on a row boundary,
// never half-way up whatever is standing there.
export function dropY(items, index, slotWidth = SLOT_WIDTH) {
  const rows = packSlot(items, slotWidth);
  let i = 0;
  for (const r of rows) {
    if (index <= i) return r.y;
    i += r.at.length;
  }
  return rows.reduce((n, r) => n + r.h, 0);
}

export function moveItem(slots, ref, toSlot, toIndex) {
  const from = slots.findIndex((b) => b.some((i) => i.ref === ref));
  if (from < 0) return slots;
  const item = slots[from].find((i) => i.ref === ref);
  const out = slots.map((b) => b.filter((i) => i.ref !== ref));
  const slot = Math.max(0, Math.min(out.length - 1, toSlot));
  const at = Math.max(0, Math.min(out[slot].length, toIndex));
  out[slot] = [...out[slot].slice(0, at), item, ...out[slot].slice(at)];
  return out;
}

// Take the selected items into a slot of their own. Splitting is between BAYS:
// a slot may be a separate piece of joinery, but it is the same container.
export function splitToSlot(slots, refs) {
  const taken = new Set(refs);
  const moved = slots.flat().filter((i) => taken.has(i.ref));
  if (!moved.length) return slots;
  return [...slots.map((b) => b.filter((i) => !taken.has(i.ref))), moved];
}

export function addSlot(slots) { return [...slots, []]; }

// Turn an item on its side. The drawings do this to fit a run of drivers across
// a slot that would not take them lying down.
export const rotate = (slots, ref) =>
  slots.map((b) => b.map((i) => (i.ref === ref ? { ...i, rot: i.rot === 90 ? 0 : 90 } : i)));

// H1 and H2 are two drawings, not one drawing of two slots. So a slot marked
// separate is its own sheet with its own dimensions, and everything else shares
// one. Returns [{ slots: [index, …], separate }].
export function sheets(slotCount, separate = []) {
  const apart = new Set(separate);
  const together = [];
  const out = [];
  for (let b = 0; b < slotCount; b += 1) {
    if (apart.has(b)) out.push({ slots: [b], separate: true });
    else together.push(b);
  }
  return together.length ? [{ slots: together, separate: false }, ...out] : out;
}

// Drop the last slot, its contents falling back into the one before it.
export function removeSlot(slots) {
  if (slots.length <= 1) return slots;
  const last = slots[slots.length - 1];
  const rest = slots.slice(0, -1);
  return [...rest.slice(0, -1), [...rest[rest.length - 1], ...last]];
}

// Spread everything evenly, the first pass rather than the product.
export function rebalance(slots) {
  const all = slots.flat();
  const n = Math.max(1, slots.length);
  const per = Math.ceil(all.length / n);
  return Array.from({ length: n }, (_, i) => all.slice(i * per, (i + 1) * per));
}

// ---- Saving a layout to Parameters, and getting it back --------------------
// The whole point of the exercise: an arrangement somebody made by hand has to
// survive in the DesignDB and come back as the same drawing. Page 100966 gives
// every flavour needed except one.
//
//   which slot       Elements.ContextParameters   <2>          discrete space
//   where in it     Elements.ContextParameters   [50mm,25mm,] continuous space
//   which container       Elements.ContextRef - handled by the patch
//   how big a part  ElementTypes.Parameters      [153mm,50mm,23mm]
//   how big the container the container row's Parameters     [[380mm,1035mm,150mm]]
//   how many slots   the container row's Parameters     <1,2>
//
// A container is NOT necessarily an Element. On the live projects it is usually a
// Position (P8110, labelled CSB) but it can be an Element, and page 100966 puts
// available continuous space on "Locations/Positions/Elements and Types" for
// exactly that reason. So the container's kind is carried, never assumed: it decides
// which sheet the [[capacity]] is written to and what ContextType every driver
// contexted into it gets. Guessing it wrong points the whole container at a row that
// does not exist.
//
// Turned 90 is the gap: the page says so itself, twice, in grey - "(future
// addition: rotational origin translation)". The documented way round it is the
// line above it: "Parameters recorded on the entity will override any
// information recorded at type level". So a turned driver carries its own
// as-placed [w,h,d] on the Element, swapped against its type's, which both
// renders correctly and reads back as turned without inventing syntax.

// Locations, Positions and Elements can all hold a layout. Anything else is a
// caller's mistake worth failing on rather than defaulting away.
const CONTEXT_KINDS = ['Location', 'Position', 'Element'];

export function contextType(container) {
  const k = container?.contextType ?? container?.kind ?? null;
  if (k == null) return null;
  const found = CONTEXT_KINDS.find((c) => c.toLowerCase() === String(k).toLowerCase());
  if (!found) throw new Error(`container contextType must be one of ${CONTEXT_KINDS.join('/')}, got ${k}`);
  return found;
}

// A slot that has been separated is its own piece of joinery. The pieces are the
// sheets: the joined slots are one, and each slot marked separate is another. They
// are named A, B, C in that order, and the name is the GROUP of every slot space
// the piece holds (page 1410108, <Group.Space>): <A.1,A.2,B.1> says A.1 and A.2 stand
// together and B.1 is a cabinet of its own. That is all it takes to record a
// separation, so by default nothing else is written.
//
// An enclosure Element per piece is the option. Measured on set 108908: where a hub
// is split, it carries one enclosure per piece, 27 hubs with two named #72.1 and
// #72.2 under #72, so a split writes BOTH, never only the piece that was broken out.
//
//   set 108713   51 drivers on the container Position,   0 on an Element
//   set 108857   91 on the Position,                    67 on an Element
//   set 108908   95 on the Position,                   578 on an Element
//
// ponytail: group names run A to Z; a hub split into more than 26 pieces is not one.
const groupName = (k) => String.fromCharCode(65 + k);

export function pieces(slotCount, separate = []) {
  return sheets(slotCount, separate).map((s, k) => ({ group: groupName(k), slots: s.slots }));
}

// Enclosure Elements are named the way the live data names them: the container's
// name, a dot, and the piece number.
export const slotLabel = (container, i) => `${container?.name ?? container?.ref ?? '#hub'}.${i + 1}`;

// A piece's own slots: their widths, heights, and where each starts from the
// piece's origin, which is where every coordinate inside the piece is measured from.
function pieceGeometry(slots, piece, opts) {
  const widths = piece.slots.map((i) => widthAt(i, opts));
  const heights = piece.slots.map((i) => heightAt(i, opts));
  const sub = { ...opts, widths, heights };
  const off = offsetsOf(piece.slots.length, sub);
  const ext = extent(piece.slots.map((i) => slots[i]), sub);
  const depth = opts.depth ?? DEPTH_MM;
  const bays = piece.slots.map((i, k) => ({
    slot: i, bay: k + 1, off: off[k],
    size: [widths[k], Math.max(slotHeight(slots[i], widths[k]), heights[k]), depth],
  }));
  return { ext, depth, bays };
}

// One Element's fields, given where it sits. `parameters` is null unless the part is
// turned, because an upright one has nothing to say that its type does not.
export function saveItem(placed, parent, { space, x }) {
  const size = placed.size ?? null;                 // as placed, already turned
  return {
    ref: placed.ref,
    contextType: contextType(parent),
    contextRef: parent?.ref ?? null,
    contextParameters: formatParams({ spaces: space, size: [x, placed.y, 0] }),
    parameters: placed.rot === 90 && size ? formatParams({ size }) : null,
  };
}

// What the container row says with no enclosure Elements: every slot as a space in
// its piece's group, with its size and its start from the piece's origin, and the
// whole hub as the capacity - the pieces' widths added up, the tallest height.
export const saveContainer = (slots, opts = {}) => {
  if (!slots.length) return '';
  let w = 0;
  let h = 0;
  let depth = opts.depth ?? DEPTH_MM;
  const spaceList = [];
  for (const piece of pieces(slots.length, opts.separate ?? [])) {
    const g = pieceGeometry(slots, piece, opts);
    w += g.ext.w;
    h = Math.max(h, g.ext.h);
    depth = g.depth;
    for (const b of g.bays) spaceList.push({ name: `${piece.group}.${b.bay}`, size: b.size, at: [b.off, 0, 0] });
  }
  return formatParams({ capacity: [w, h, depth], spaceList });
};

export function save(slots, opts = {}) {
  const container = opts.container ?? null;
  const enclosures = !!opts.enclosures;
  const all = pieces(slots.length, opts.separate ?? []);
  const globalOff = offsetsOf(slots.length, opts);

  // where each slot sits: its piece, its number within it, and its start in it
  const where = new Map();
  const pieceRows = [];
  all.forEach((piece, k) => {
    const g = pieceGeometry(slots, piece, opts);
    for (const b of g.bays) where.set(b.slot, { group: piece.group, bay: b.bay, off: b.off });
    if (!enclosures) return;
    // One enclosure per piece, the way #72.1 and #72.2 sit under #72. Its Ref is
    // the workbook's to allocate, so an unnamed one is flagged rather than invented.
    const ref = opts.pieceRefs?.[piece.group] ?? null;
    pieceRows.push({
      group: piece.group,
      slot: piece.slots[0],
      ref,
      name: slotLabel(container, k),
      typeRef: opts.wrapperType ?? null,
      contextType: contextType(container),
      contextRef: container?.ref ?? null,
      parameters: formatParams({
        capacity: [g.ext.w, g.ext.h, g.depth],
        spaceList: g.bays.map((b) => ({ name: String(b.bay), size: b.size, at: [b.off, 0, 0] })),
      }),
      isNew: !ref,
    });
  });

  const elements = placements(slots, opts).map((p) => {
    const w = where.get(p.slot);
    const x = p.x - globalOff[p.slot] + w.off;
    if (enclosures) {
      const row = pieceRows.find((r) => r.group === w.group);
      return saveItem(p, { ref: row.ref, contextType: 'Element' }, { space: String(w.bay), x });
    }
    return saveItem(p, container, { space: `${w.group}.${w.bay}`, x });
  });

  // with enclosures the sizes live on the pieces, so the hub row is cleared rather
  // than left claiming bays that are now somebody else's to state
  const hubParams = enclosures ? '' : saveContainer(slots, opts);
  return {
    container: {
      ref: container?.ref ?? null,
      contextType: contextType(container),
      parameters: hubParams,
      clear: hubParams === '',
    },
    slots: pieceRows,
    elements,
  };
}

// ---- and back ----------------------------------------------------------------

// The pieces a stored hub describes. The hub row's grouped spaces (<A.1,A.2,B.1>),
// then any enclosure rows under it, each a piece of its own with its slots in its
// own Parameters (<1,2>). A row written before groups (<1,2>) is piece A.
function storedPieces(hubParams, enclosureRows = []) {
  const groups = new Map();
  for (const sp of parseParams(hubParams ?? '').spaceList ?? []) {
    const m = /^(?:(.+)\.)?(\d+)$/.exec(String(sp.name).trim());
    if (!m) continue;
    const key = m[1] ?? 'A';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ n: Number(m[2]), size: sp.size, at: sp.at });
  }
  const out = [...groups.keys()].sort().map((key) => ({ key, from: 'hub', bays: groups.get(key) }));
  const byName = (r) => Number(/\.(\d+)$/.exec(r.name ?? '')?.[1] ?? 0);
  for (const r of [...enclosureRows].sort((a, b) => byName(a) - byName(b))) {
    const p = parseParams(r.parameters ?? '');
    const bays = (p.spaceList ?? []).filter((sp) => Number(sp.name) > 0)
      .map((sp) => ({ n: Number(sp.name), size: sp.size, at: sp.at }));
    out.push({ key: r.ref, from: 'enclosure', ref: r.ref, bays: bays.length ? bays : [{ n: 1, size: p.capacity, at: [0, 0, 0] }] });
  }
  for (const piece of out) piece.bays.sort((a, b) => a.n - b.n);
  return out;
}

// The slots a container row states, in drawing order, with each one's size and its
// start within its piece. Indexed by slot; null where the row does not say.
export function bayGeometry(params) {
  const out = { held: [], widths: [], heights: [], offsets: [], groups: [] };
  let slot = 0;
  for (const piece of storedPieces(params)) {
    out.groups.push({ group: piece.key, slots: piece.bays.map((_, k) => slot + k) });
    for (const b of piece.bays) {
      out.held.push(slot + 1);
      out.widths[slot] = b.size?.[0] ?? null;
      out.heights[slot] = b.size?.[1] ?? null;
      out.offsets[slot] = b.at?.[0] ?? null;
      slot += 1;
    }
  }
  return out;
}

// A stored hub back to slots, and everything the drawing needs to show it the same:
// which slots are separate pieces, each slot's width and height, each piece's
// enclosure Ref, and whether the hub was stored with enclosure Elements at all.
//
// Order within a slot is taken from the saved coordinates rather than assumed: the
// row packer is deterministic, so reading y then x back gives the same sequence it
// produced, and a hand-edited coordinate still lands in the right place. Rotation
// is recovered by comparing the saved as-placed size with the type's, swapped.
export function loadLayout({ container, slots: enclosureRows = [], elements }, byRef) {
  const hubParams = typeof container === 'string' ? container : container?.parameters ?? '';
  const stored = storedPieces(hubParams, enclosureRows.filter((r) => r?.ref));
  if (!stored.length) stored.push({ key: 'A', from: 'hub', bays: [{ n: 1, size: null, at: null }] });

  const slotOf = new Map();     // `${pieceKey}|${n}` -> slot
  const refOf = new Map();      // enclosure Ref -> piece key
  const separate = [];
  const widths = [];
  const heights = [];
  const refs = {};
  let slot = 0;
  stored.forEach((piece, k) => {
    if (piece.ref) refOf.set(piece.ref, piece.key);
    piece.bays.forEach((b, j) => {
      slotOf.set(`${piece.key}|${b.n}`, slot);
      widths[slot] = b.size?.[0] ?? null;
      heights[slot] = b.size?.[1] ?? null;
      // the first piece is the joined one; every other piece is drawn apart
      if (k > 0) separate.push(slot);
      if (j === 0 && piece.ref) refs[slot] = piece.ref;
      slot += 1;
    });
  });
  const count = Math.max(1, slot);
  const first = stored[0].key;

  const out = Array.from({ length: count }, () => []);
  const rows = (elements ?? [])
    .map((e) => {
      const item = byRef[e.ref];
      if (!item) return null;
      const cp = parseParams(e.contextParameters);
      const m = /^(?:(.+)\.)?(\d+)$/.exec(String(cp.spaces ?? '').trim());
      const inPiece = e.contextRef && refOf.get(e.contextRef);
      const key = inPiece ?? m?.[1] ?? first;
      const s = slotOf.get(`${key}|${m ? Number(m[2]) : 1}`) ?? slotOf.get(`${key}|1`) ?? 0;
      const [x, y] = cp.size ?? [0, 0];
      const own = parseParams(e.parameters ?? '').size;
      const turned = !!own && !!item.size
        && Math.abs(own[0] - item.size[1]) < 0.05 && Math.abs(own[1] - item.size[0]) < 0.05;
      return { slot: Math.min(s, count - 1), x: x ?? 0, y: y ?? 0, item, turned };
    })
    .filter(Boolean)
    .sort((a, b) => a.slot - b.slot || a.y - b.y || a.x - b.x);
  for (const r of rows) out[r.slot].push(r.turned ? { ...r.item, rot: 90 } : { ...r.item, rot: 0 });

  return { slots: out, separate, widths, heights, refs, enclosures: stored.some((p) => p.from === 'enclosure') };
}

export const load = (stored, byRef) => loadLayout(stored, byRef).slots;
