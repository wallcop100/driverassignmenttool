// Resizing on a grid. Snapped by default so sizes come out as round numbers a
// joiner will build to; Alt drops to 1mm when you need to be exact, Shift jumps
// five steps when you want to move a long way. Pure, so the feel is tested.

export const DEFAULT_SNAP = 5;
export const SNAP_PRESETS = [1, 5, 10, 25, 50];

export const stepOf = (snap = DEFAULT_SNAP, { alt = false, shift = false } = {}) => {
  const s = snap > 0 ? snap : DEFAULT_SNAP;
  if (alt) return 1;
  return shift ? s * 5 : s;
};

export const snapTo = (value, step) => Math.round(value / step) * step;

// A drag: where the edge started, how far the pointer has moved, in mm. Never
// below `min` - a bay cannot be narrower than what it holds.
export const dragTo = (start, delta, snap, mods = {}, { min = 0 } = {}) =>
  Math.max(min, snapTo(start + delta, stepOf(snap, mods)));

// An arrow key: to the next grid line in that direction, not one step from an
// off-grid value, so a nudge always lands on the grid.
export function nudge(value, dir, snap, { shift = false, min = 0 } = {}) {
  const s = stepOf(snap, { shift });
  const next = dir > 0
    ? Math.floor(value / s + 1e-9) * s + s
    : Math.ceil(value / s - 1e-9) * s - s;
  return Math.max(min, next);
}
