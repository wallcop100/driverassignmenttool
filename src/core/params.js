// Parameter Syntax (Kaizen page 100966), as code.
//
// One field carries several flavours — {nodes}, <discrete spaces>, [size] and
// [[capacity]] — and they share the column: the live AV type ET-UNICA-8M-4K8
// holds '[,,1U]{>ETH.01,...}'. Each flavour is claimed by its brackets and the
// rest is left exactly as it was, which is what lets a patch MERGE rather than
// overwrite: a driver type's {<OP.1,<OP.2} has to survive a size being written
// beside it, and a panel type's <01,02,LB1> has to survive the same.
//
// Nothing here knows about drivers, hubs, panels or modules. Both tools live on
// this syntax, so this is the one module they are guaranteed to share.
//
// Units are millimetres throughout. Unitless in the DesignDB means mm.

const NUM = /^-?\d*\.?\d+/;

// '600mm' | '60cm' | '600' | '0.6m' -> 600. Unitless is mm, which is what the
// DesignDB means by a bare number here.
export function mm(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  const m = NUM.exec(s);
  if (!m) return null;
  const n = Number(m[0]);
  const unit = s.slice(m[0].length).trim().toLowerCase();
  if (unit === 'm') return n * 1000;
  if (unit === 'cm') return n * 10;
  return n;                       // mm, or none given
}

export const asMm = (n) => (n == null ? '' : `${+Number(n).toFixed(1)}mm`);

// ---- Parameters: several flavours, one field -------------------------------
// Parameter Syntax (page 100966) gives {nodes}, <discrete spaces>, [size] and
// [[capacity]], and they share the column: ET-UNICA-8M-4K8 holds
// '[,,1U]{>ETH.01,...}'. Each flavour is claimed by its brackets and the rest is
// left exactly as it was, which is what lets the patch merge rather than
// overwrite — a driver type's {<OP.1,<OP.2} has to survive a size being written
// beside it.
export function parseParams(str) {
  const s = String(str ?? '');
  const out = { size: null, capacity: null, nodes: null, spaces: null, rest: '' };
  let rest = s;

  const take = (re) => {
    const m = re.exec(rest);
    if (!m) return null;
    rest = rest.slice(0, m.index) + rest.slice(m.index + m[0].length);
    return m;
  };

  // [[...]] before [...], or the capacity reads as a size with a stray bracket
  const cap = take(/\[\[([^\]]*)\]\]/);
  if (cap) out.capacity = triple(cap[1]);
  const size = take(/\[([^\]]*)\]/);
  if (size) out.size = triple(size[1]);
  const nodes = take(/\{([^}]*)\}/);
  if (nodes) out.nodes = nodes[1];
  const spaces = take(/<([^>]*)>/);
  if (spaces) out.spaces = spaces[1];
  out.rest = rest.trim();
  return out;
}

// '80mm,30mm,' -> [80, 30, null]. A missing axis stays missing rather than
// becoming 0: the schema treats an omitted coordinate and a zero differently.
function triple(body) {
  const parts = String(body).split(',');
  const v = [0, 1, 2].map((i) => mm((parts[i] ?? '').trim()));
  return v.every((x) => x == null) ? null : v;
}

const tripleStr = (t) => (t ?? []).slice(0, 3).map((n) => (n == null ? '' : asMm(n))).join(',');

// Back to one string, size first then nodes — the order ET-UNICA-8M-4K8 uses.
export function formatParams(p) {
  const bits = [];
  if (p.capacity) bits.push(`[[${tripleStr(p.capacity)}]]`);
  if (p.size) bits.push(`[${tripleStr(p.size)}]`);
  if (p.spaces) bits.push(`<${p.spaces}>`);
  if (p.nodes) bits.push(`{${p.nodes}}`);
  if (p.rest) bits.push(p.rest);
  return bits.join('');
}

// Write a size into a field without disturbing whatever else it holds.
export const withSize = (params, size) =>
  formatParams({ ...parseParams(params), size });

export const withCapacity = (params, capacity) =>
  formatParams({ ...parseParams(params), capacity });
