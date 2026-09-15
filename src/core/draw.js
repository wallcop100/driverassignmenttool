// The house drawing idiom, taken from DJ 101676's LCP rack detail (page 139763)
// so a hub elevation and a panel elevation read as the same family of drawing.
//
// Pure decisions only — a fill, a stroke, where a label goes and how big. The
// SVG itself is written by whichever component is drawing, because a hub needs
// hatching and dimension lines that a panel does not.

// Fill by what a block IS, so a drawing reads at a glance instead of being a
// wall of identical white boxes. The four colours are 101676's.
export const FILLS = {
  processor: '#00b050',   // the thing doing the work: an LCP processor, a driver
  driver: '#00b050',
  signal: '#e8112d',      // DALI / control: a DALI module, a PSU feeding one
  psu: '#e8112d',
  keypad: '#7048b6',
  passive: '#d9dee3',     // Panduit, junction boxes, trunking — no intelligence
  jbox: '#d9dee3',
  blank: '#ffffff',
};

export const STROKE = '#111';
export const SPARE_STROKE = '#c41f4b';
export const SPARE_LABEL = 'SPARE — DO NOT CONNECT';

// White lettering on a saturated fill, near-black on a pale one.
const PALE = new Set(['#d9dee3', '#ffffff']);
export const fillFor = (kind) => FILLS[kind] ?? FILLS.blank;
export const inkFor = (fill) => (PALE.has(fill) ? '#111' : '#fff');

// How a block is drawn when nothing is in it. 101676 draws a real empty slot
// rather than skipping it, because a spare way is a fact about the panel.
export const spareStyle = () => ({
  fill: '#fff', stroke: SPARE_STROKE, dash: '6 4', ink: SPARE_STROKE,
});

// ---- scale ----------------------------------------------------------------
// 101676 carries a CAUTION: its drawing is a SCHEMATIC — widths are clamped for
// legibility and nothing may be measured off it. A hub elevation is the
// opposite: it states a size a joiner will build to. Same idiom, two policies,
// and they must not be confused.
export const SCHEMATIC_MIN = 55;
export const SCHEMATIC_MAX = 320;

export function scaler(policy = 'true', pxPerMm = 1) {
  if (policy === 'true') return (mmVal) => mmVal * pxPerMm;
  return (mmVal) => Math.min(SCHEMATIC_MAX, Math.max(SCHEMATIC_MIN, mmVal * pxPerMm));
}

// ---- labels ---------------------------------------------------------------
// Helvetica-ish average glyph width as a fraction of font size. Good enough to
// decide across-vs-turned without measuring text in a DOM.
const CHAR = 0.55;
export const textWidth = (text, size) => String(text ?? '').length * size * CHAR;

// Where a block's lettering goes. 101676 turns a label through -90 when the
// block is too narrow for it — the 25mm Panduit case — rather than shrinking it
// to nothing or letting it run outside the box.
//
// Returns { mode, size, sub } where mode is 'across' | 'turned' | 'none'.
// `sub` is the second line ("E41763 - 105mm"), dropped first when room is tight.
export function labelPlan(label, sub, wPx, hPx, { base = 11, min = 7, pad = 8 } = {}) {
  if (!label) return { mode: 'none', size: 0, sub: null };
  const fits = (size, across) => textWidth(label, size) <= (across ? wPx : hPx) - pad;

  for (let size = base; size >= min; size -= 0.5) {
    if (!fits(size, true)) continue;
    // two lines need the height for both, plus breathing room
    const room = hPx >= size * 2 + 6;
    return { mode: 'across', size, sub: sub && room ? sub : null };
  }
  // too narrow to read across — turn it, which is what the drawings do
  for (let size = base; size >= min; size -= 0.5) {
    if (fits(size, false) && wPx >= size + 2) return { mode: 'turned', size, sub: null };
  }
  return { mode: 'none', size: 0, sub: null };
}

// The second line under a block's name, as 101676 writes it: "E41763 - 105mm".
export const subLabel = (ref, mmWide) =>
  [ref, mmWide != null ? `${+Number(mmWide).toFixed(1)}mm` : null].filter(Boolean).join(' - ');
