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

// Feed Provision is drawn at the bottom of a bay in every hub that has one.
export const feedItem = (w = 330, h = 105) =>
  ({ ref: '__feed', label: 'Feed provision', kind: 'feed', size: [w, h] });

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
