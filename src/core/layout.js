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


// Two slots standing together share the gap between them: the centre is 50, not
// the 100 they would make by each bringing its own 50. So a joined slot is
// pitched one clearance closer than its width. Bays on separate sheets are
// separate pieces of joinery and keep their own full clearance.
export const pitchOf = (slotWidth, joined = true) => (joined ? slotWidth - CLEAR_X : slotWidth);

// Each slot's own width: widths[i] where one is given, else slotWidth. A hub is
// not always two identical bays - a 500 beside a 380 is ordinary joinery.
export const widthAt = (i, { slotWidth = SLOT_WIDTH, widths = null } = {}) =>
  (widths?.[i] > 0 ? widths[i] : slotWidth);

// Where each slot starts across the container. Joined slots share the 50mm
// between them, so each starts one clearance before the previous one ended.
// With every width equal this is slot x pitch, which is what it replaced.
export function offsetsOf(count, opts = {}) {
  const joined = opts.joined ?? true;
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
    // a row is one orientation: the trunking cannot be down the sides and across
    // the ends of the same row
    if (row && (row.inset !== inset
      || row.x + Math.max(row.clearX, c.x) + size[0] > avail + 0.01)) close();
    if (!row) {
      row = {
        at: [], x: 0, h: 0, clearX: 0, inset,
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
  const { width = null, joined = true } = opts;
  const n = Math.max(1, slots.length);
  let w = 0;
  for (let i = 0; i < n; i += 1) w += widthAt(i, opts);
  if (joined) w -= (n - 1) * CLEAR_X;
  return {
    w: Math.round(width ?? w),
    h: Math.max(0, ...slots.map((b, i) => slotHeight(b, widthAt(i, opts)))),
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

// A slot that has been separated is its own piece of joinery, and the DesignDB
// already has a shape for that. Measured across six live sets:
//
//   set 108713   51 drivers on the container Position,   0 on an Element
//   109311 / 109314    223 / 185 on the Position,         0 on an Element
//   set 108857    91 on the Position,             67 on an Element
//   set 108908        95 on the Position,            578 on an Element
//   109303              104 on the Position,            580 on an Element
//
// Where a driver sits on an Element, that Element is an ET-PSU-ENC-* enclosure
// contexted into the container Position - and on set 108908 218 container Positions carry ONE
// enclosure while 27 carry TWO, named #72.1 and #72.2 under container #72. That is the
// H1/H2 split, already modelled. The two can even be different enclosure types
// (#71.1 is -V5, #71.2 is -V1), which is how B1 and B2 come out different sizes.
//
// So: joined slots stay on the Position, and a separated slot becomes an enclosure
// Element with its drivers contexted into it. Nothing here invents a convention.

// Bay Elements are named the way the live data names them: the container's name, a
// dot, and the slot number.
export const slotLabel = (container, i) => `${container?.name ?? container?.ref ?? '#hub'}.${i + 1}`;

// A slot split out of its container becomes a wrapper Element of its own. What
// TYPE that wrapper is, is the calling tool's business - the driver tool has one
// generic PSU enclosure type; a panel may not split at all. Core never invents
// one: `opts.wrapperType` or nothing.

// One Element's fields. `parameters` is null unless the part is turned, because
// an upright one has nothing to say that its type does not. `contextType` is
// what the part is contexted INTO - a separated slot's enclosure Element, or the
// container itself.
export function saveItem(placed, parent = null, { local = false } = {}) {
  const size = placed.size ?? null;                 // as placed, already turned
  const turned = placed.rot === 90;
  return {
    ref: placed.ref,
    contextType: contextType(parent),
    contextRef: parent?.ref ?? null,
    contextParameters: formatParams({
      // inside a slot Element there is only one slot, so the discrete space is
      // what the parent already says. On the container it is the slot number.
      spaces: local ? null : String(placed.slot + 1),
      size: [local ? placed.x - placed.bayX : placed.x, placed.y, 0],
    }),
    parameters: turned && size ? formatParams({ size }) : null,
  };
}

// What a container row says: how big it came out, and which slots it still holds
// directly. A slot that has been separated is no longer one of them - it is an
// enclosure Element of its own, and says its own size.
// What the container row says, for the slots it still holds ITSELF. A slot split out to
// an Element takes its parameters with it - two rows both claiming to state the
// same slot's size is how a drawing and a database stop agreeing. So when every
// slot has been separated the container states nothing, and the patch must CLEAR what
// is already on the row rather than leave a stale capacity behind.
export const saveContainer = (slots, opts = {}) => {
  const own = slots.map((_, i) => i).filter((i) => !(opts.separate ?? []).includes(i));
  if (!own.length) return '';
  // the sub-list is re-indexed, so its widths have to travel with it
  const ext = extent(own.map((i) => slots[i]), { ...opts, widths: own.map((i) => widthAt(i, opts)) });
  return formatParams({
    capacity: [ext.w, ext.h, opts.depth ?? DEPTH_MM],
    spaces: own.map((i) => i + 1).join(','),
  });
};

export function save(slots, opts = {}) {
  const container = opts.container ?? null;
  const separate = opts.separate ?? [];
  const off = offsetsOf(slots.length, opts);

  // A separated slot becomes an ET-PSU-ENC-* Element under the container Position, the
  // way #72.1 and #72.2 sit under #72 on set 108908. Its Ref is the workbook's to
  // allocate, so an unnamed one is flagged rather than invented.
  const slotRows = separate.slice().sort((a, b) => a - b).map((i) => ({
    slot: i,
    ref: opts.wrapperRefs?.[i] ?? null,
    name: slotLabel(container, i),
    typeRef: opts.wrapperType ?? null,
    contextType: contextType(container),
    contextRef: container?.ref ?? null,
    parameters: formatParams({
      capacity: [
        extent([slots[i]], { ...opts, widths: [widthAt(i, opts)] }).w,
        slotHeight(slots[i], widthAt(i, opts)),
        opts.depth ?? DEPTH_MM,
      ],
      spaces: '1',
    }),
    isNew: !opts.wrapperRefs?.[i],
  }));
  const byBay = new Map(slotRows.map((b) => [b.slot, b]));

  const elements = placements(slots, opts).map((p) => {
    const owner = byBay.get(p.slot);
    // contexted into its slot Element when that slot stands alone, into the container
    // when it does not - and a slot-local coordinate follows its parent
    return owner
      ? saveItem({ ...p, bayX: off[p.slot] }, { ref: owner.ref, contextType: 'Element' }, { local: true })
      : saveItem(p, container);
  });

  const hubParams = saveContainer(slots, opts);
  return {
    container: {
      ref: container?.ref ?? null,
      contextType: contextType(container),
      parameters: hubParams,
      // an empty string is not "write nothing", it is "clear what is there":
      // the size has moved onto the slot Elements and must not be left behind
      clear: hubParams === '',
    },
    slots: slotRows,
    elements,
  };
}

// And back. `byRef` supplies each part as the model holds it - crucially its
// UNTURNED size, which is what the type states; comparing the saved as-placed
// size against it is how the rotation is recovered.
//
// Order within a slot is taken from the saved coordinates rather than assumed:
// the row packer is deterministic, so reading y then x back gives the same
// sequence it produced, and a hand-edited coordinate still lands in the right
// place.
export function load({ container, slots: slotRows = [], elements }, byRef, opts = {}) {
  // a container saved before its kind was carried is a bare string; both are read
  const params = typeof container === 'string' ? container : container?.parameters ?? '';
  const held = parseParams(params).spaces?.split(',').map(Number).filter(Boolean) ?? [];
  // the container's own slots plus the ones that were separated out into Elements
  const count = Math.max(1, ...held, ...slotRows.map((b) => b.slot + 1), 1);
  const off = offsetsOf(count, opts);
  const ownerOf = new Map(slotRows.filter((b) => b.ref).map((b) => [b.ref, b]));
  const slots = Array.from({ length: count }, () => []);
  const rows = elements
    .map((e) => {
      const item = byRef[e.ref];
      if (!item) return null;
      const cp = parseParams(e.contextParameters);
      // contexted into a slot Element: the slot is the parent, and the coordinate
      // is relative to it rather than to the container
      const owner = e.contextRef ? ownerOf.get(e.contextRef) : null;
      const slot = owner ? owner.slot : Math.max(0, (Number(cp.spaces) || 1) - 1);
      const [rawX, y] = cp.size ?? [0, 0];
      const x = (rawX ?? 0) + (owner ? off[owner.slot] : 0);
      // turned iff the Element states a size and it is its type's, swapped
      const own = parseParams(e.parameters ?? '').size;
      const turned = !!own && !!item.size
        && Math.abs(own[0] - item.size[1]) < 0.05 && Math.abs(own[1] - item.size[0]) < 0.05;
      return { slot: Math.min(slot, count - 1), x: x ?? 0, y: y ?? 0, item, turned };
    })
    .filter(Boolean)
    .sort((a, b) => a.slot - b.slot || a.y - b.y || a.x - b.x);
  for (const r of rows) {
    slots[r.slot].push(r.turned ? { ...r.item, rot: 90 } : { ...r.item, rot: 0 });
  }
  return slots;
}
