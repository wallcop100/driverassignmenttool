// The PSU hub: the driver tool's slice of the shared layout model.
//
// A hub is a container and a bay is a slot, so the geometry, the edits and the
// save/load round trip all live in core/layout.js. What is here is what only a
// hub has - Feed Provision, a driver composed with its PSU and junction boxes,
// and the one generic enclosure type a separated bay becomes - plus the hub
// vocabulary the rest of this tool is written in.
import * as L from './core/layout.js';
import { GAP } from './core/layout.js';

export * from './core/layout.js';

// Hub words for core's container words. A bay IS a slot; calling it a bay here
// keeps the drawings, the CAD sheets and the code using one term.
export const BAY_WIDTH = L.SLOT_WIDTH;
export const packBay = L.packSlot;
export const bayHeight = L.slotHeight;
export const addBay = L.addSlot;
export const removeBay = L.removeSlot;
export const splitToBay = L.splitToSlot;
export const bayName = L.slotLabel;

// Feed Provision is not the drawing's own box: the projects already place it as
// Elements, ET-CCR-FEED-PROV and ET-CVR-FEED-PROV on set 108857, and those rows
// arrive with the hub's drivers. ET-PROV-DRIVER-01 is a provisional DRIVER, not
// a feed, which is why the match needs FEED.
export const isFeed = (typeRef) => /FEED-?PROV/i.test(String(typeRef ?? ''));

// A feed provision type with no size of its own is drawn at this, marked as not
// in the DB, until somebody gives the type one.
export const FEED_SIZE = [280, 105, 50];

// ...except its width. A feed with no stated size runs across the bay, so it
// takes the width of whatever else the bay holds, or of the width typed for the
// bay, rather than setting it: 280 plus the trunking is exactly 380, and letting
// the placeholder decide would pin every bay at 380 again.
export function spanFeeds(items, typedWidth = null) {
  const loose = (i) => i.kind === 'feed' && i.sizedBy === 'datasheet' && i.size;
  if (!items.some(loose)) return items;
  const others = items.filter((i) => !loose(i));
  const width = typedWidth > 0 ? typedWidth : others.length ? L.naturalWidth(others) : L.SLOT_WIDTH;
  const w = Math.max(50, width - 2 * L.TRUNK);
  const wide = (s) => [w, s[1], s[2]];
  return items.map((i) => (loose(i)
    ? { ...i, size: wide(i.size), parts: (i.parts ?? []).map((p) => ({ ...p, size: wide(p.size) })) }
    : i));
}

// Where a size comes from, strongest first. Typed here beats the DB because it
// is a change on top of it; the DB beats the datasheet because it is the
// design's own; the datasheet is the plaster that lets work carry on.
export function resolveSize({ edited = null, db = null, datasheet = null } = {}) {
  const ok = (s) => s?.[0] > 0 && s?.[1] > 0;
  if (ok(edited)) return { size: edited, origin: 'edited' };
  if (ok(db)) return { size: db, origin: 'db' };
  if (ok(datasheet)) return { size: datasheet, origin: 'datasheet' };
  return { size: null, origin: 'missing' };
}

// A module is not one rectangle. The drawings compose it: the PSU across the
// top, the driver bottom left, its junction boxes stacked bottom right.
//
//      +---------------------------+
//      |    Meanwell HLG-185-24    |
//      +---------------+-----------+
//      | EldoLED 220D  | JUNCTION  |
//      |               | JUNCTION  |
//      +---------------+-----------+
//
// So an item carries `parts`, each with its own offset from the module's corner,
// and the module's size falls out of them. A driver with no PSU and no junction
// boxes is a module of one part, which is just the rectangle it always was.
export function composite(parts) {
  const psu = parts.find((p) => p.kind === 'psu');
  const driver = parts.find((p) => p.kind === 'driver');
  const boxes = parts.filter((p) => p.kind === 'jbox');
  if (!driver?.size) return null;

  const boxW = boxes.length ? Math.max(...boxes.map((b) => b.size[0])) : 0;
  const boxH = boxes.reduce((n, b) => n + b.size[1], 0);
  const lowerW = driver.size[0] + (boxes.length ? GAP + boxW : 0);
  const lowerH = Math.max(driver.size[1], boxH);
  const w = Math.max(lowerW, psu?.size?.[0] ?? 0);
  const h = lowerH + (psu?.size ? psu.size[1] + GAP : 0);

  const out = [{ ...driver, at: [0, 0] }];
  let by = lowerH;
  for (const b of boxes) { by -= b.size[1]; out.push({ ...b, at: [driver.size[0] + GAP, by] }); }
  if (psu?.size) out.push({ ...psu, at: [0, lowerH + GAP] });
  return { size: [w, h, Math.max(...parts.filter((p) => p.size).map((p) => p.size[2] ?? 0))], parts: out };
}


// ONE enclosure type, not a catalogue. set 108908 grew ET-PSU-ENC-T1/2-V1 through
// T11-V7 plus -EXT variants - a type per size - and that caused more trouble
// than it solved. A separated bay is a logical wrapper: it holds drivers and
// states its own size in its own Parameters, so the type does not need to encode
// the size at all.
export const ENCLOSURE_TYPE = 'ET-PSU-ENC';

// core/layout.save() never invents a wrapper type; the hub always has one.
export const save = (bays, opts = {}) =>
  L.save(bays, { wrapperType: ENCLOSURE_TYPE, ...opts });

// `export *` already re-exported core's save; this one has to win.

// A row with a Quantity is N identical drivers in one stack: drawn at true size,
// with the clearance each would keep from the next, so the bay comes out exactly
// as tall as N separate drivers would make it. It moves as one until it is broken
// apart, and saves as the one row it is.
export function stack(module, qty) {
  if (!(qty > 1) || !module?.size) return module;
  const [w, h, d] = module.size;
  const pitch = h + 2 * L.CLEAR_Y;
  const parts = [];
  for (let k = 0; k < qty; k += 1) {
    for (const p of module.parts ?? []) {
      parts.push({ ...p, at: [p.at?.[0] ?? 0, (p.at?.[1] ?? 0) + k * pitch, p.at?.[2] ?? 0], unit: k });
    }
  }
  return { ...module, qty, unitSize: module.size, size: [w, h * qty + 2 * L.CLEAR_Y * (qty - 1), d], parts };
}
