// Parameter Syntax (Kaizen page 100966, and its rewrite 1410108), as code.
//
// One field carries several flavours - {nodes}, <discrete spaces>, [size] and
// [[capacity]] - and they share the column: the live AV type ET-UNICA-8M-4K8
// holds '[,,1U]{>ETH.01,...}'. Each flavour is claimed by its brackets and the
// rest is left exactly as it was, which is what lets a patch MERGE rather than
// overwrite: a driver type's {<OP.1,<OP.2} has to survive a size being written
// beside it, and a panel type's <01,02,LB1> has to survive the same.
//
// The flavours nest. The rewrite lets a space carry its own size, position and
// capacity - <Rack Rear.Top[100%,40mm,50%,0,760mm,50%][[...]]> - so the brackets
// are read by depth, never by pattern: a [size] inside a <space> belongs to the
// space, not to the entity.
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

// ---- reading by depth ------------------------------------------------------

const opener = (s, i) => {
  const c = s[i];
  if (c === '[') return s[i + 1] === '[' ? '[[' : '[';
  if (c === '{' || c === '<') return c;
  return null;
};

// The index just past the group that opens at i, or -1 if it never closes.
// A node list holds < and > as directions, so inside {} only braces count; a
// space holds sizes and details, so inside <> those are stepped over whole.
export function closeAt(s, i, open) {
  if (open === '[[') { const j = s.indexOf(']]', i + 2); return j < 0 ? -1 : j + 2; }
  if (open === '[') { const j = s.indexOf(']', i + 1); return j < 0 ? -1 : j + 1; }
  if (open === '{') {
    let d = 0;
    for (let k = i; k < s.length; k += 1) {
      if (s[k] === '{') d += 1;
      else if (s[k] === '}') { d -= 1; if (d === 0) return k + 1; }
    }
    return -1;
  }
  for (let k = i + 1; k < s.length; k += 1) {
    if (s[k] === '[') {
      const inner = closeAt(s, k, s[k + 1] === '[' ? '[[' : '[');
      if (inner < 0) return -1;
      k = inner - 1;
    } else if (s[k] === '(') {
      const j = s.indexOf(')', k + 1);
      if (j < 0) return -1;
      k = j;
    } else if (s[k] === '>') {
      return k + 1;
    }
  }
  return -1;
}

const FLAVOUR = { '[[': 'capacity', '[': 'size', '{': 'nodes', '<': 'spaces' };
const WIDTH = { '[[': 2, '[': 1, '{': 1, '<': 1 };

// Every top-level group, in order, with the text between them.
function groups(str) {
  const s = String(str ?? '');
  const out = [];
  let text = '';
  let i = 0;
  while (i < s.length) {
    const open = opener(s, i);
    const end = open ? closeAt(s, i, open) : -1;
    if (!open || end < 0) { text += s[i]; i += 1; continue; }
    if (text) { out.push({ text }); text = ''; }
    out.push({ flavour: FLAVOUR[open], raw: s.slice(i, end), body: s.slice(i + WIDTH[open], end - WIDTH[open]) });
    i = end;
  }
  if (text) out.push({ text });
  return out;
}

// '80mm,30mm,' -> [80, 30, null]. A missing axis stays missing rather than
// becoming 0: the schema treats an omitted coordinate and a zero differently.
// Six values are a size and the translation of its origin.
function numbers(body) {
  const parts = String(body).split(',');
  const v = [0, 1, 2].map((i) => mm((parts[i] ?? '').trim()));
  const at = parts.length > 3 ? [3, 4, 5].map((i) => mm((parts[i] ?? '').trim())) : null;
  return { v: v.every((x) => x == null) ? null : v, at };
}

// Split a space list at its own commas, not the ones inside [..] or (..).
function splitTop(body) {
  const out = [];
  let cur = '';
  let depth = 0;
  for (const c of String(body)) {
    if (c === '[' || c === '(') depth += 1;
    if (c === ']' || c === ')') depth -= 1;
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

// '1[338mm,418mm,150mm,0,0,0]' | 'PSU(ET-CVR-PSU-24)[228mm,68mm,39mm,0,55mm,0]'
export function parseSpace(item) {
  const s = String(item).trim();
  const cut = s.search(/[[(]/);
  const out = { name: (cut < 0 ? s : s.slice(0, cut)).trim(), detail: null, size: null, at: null, capacity: null, capAt: null };
  if (cut < 0) return out;
  let i = cut;
  while (i < s.length) {
    if (s[i] === '(') {
      const j = s.indexOf(')', i);
      if (j < 0) break;
      out.detail = s.slice(i + 1, j);
      i = j + 1;
    } else if (s[i] === '[') {
      const open = s[i + 1] === '[' ? '[[' : '[';
      const end = closeAt(s, i, open);
      if (end < 0) break;
      const n = numbers(s.slice(i + open.length, end - open.length));
      if (open === '[[') { out.capacity = n.v; out.capAt = n.at; } else { out.size = n.v; out.at = n.at; }
      i = end;
    } else {
      i += 1;
    }
  }
  return out;
}

export const parseSpaceList = (body) => (body == null ? [] : splitTop(body).map(parseSpace).filter((sp) => sp.name));

// ---- Parameters: several flavours, one field -------------------------------
// The first group of each flavour is claimed; anything else, including a second
// group of a flavour already claimed, is left in `rest` exactly as written.
export function parseParams(str) {
  const out = {
    size: null, sizeAt: null, capacity: null, capacityAt: null,
    nodes: null, spaces: null, spaceList: null, rest: '',
  };
  let rest = '';
  for (const g of groups(str)) {
    if (g.text != null) { rest += g.text; continue; }
    if (g.flavour === 'capacity' && !out.capacity && !out.capacityAt) {
      const n = numbers(g.body); out.capacity = n.v; out.capacityAt = n.at;
    } else if (g.flavour === 'size' && !out.size && !out.sizeAt) {
      const n = numbers(g.body); out.size = n.v; out.sizeAt = n.at;
    } else if (g.flavour === 'nodes' && out.nodes == null) {
      out.nodes = g.body;
    } else if (g.flavour === 'spaces' && out.spaces == null) {
      out.spaces = g.body;
      out.spaceList = parseSpaceList(g.body);
    } else {
      rest += g.raw;
    }
  }
  out.rest = rest.trim();
  return out;
}

const tripleStr = (t) => (t ?? []).slice(0, 3).map((n) => (n == null ? '' : asMm(n))).join(',');
// a translation of nothing is written as 0, the way the syntax page writes it
const atStr = (t) => (t ?? []).slice(0, 3).map((n) => (n == null || n === 0 ? '0' : asMm(n))).join(',');
const sixStr = (v, at) => (at ? `${tripleStr(v)},${atStr(at)}` : tripleStr(v));

export const formatSpace = (sp) => `${sp.name}${sp.detail ? `(${sp.detail})` : ''}`
  + `${sp.size ? `[${sixStr(sp.size, sp.at)}]` : ''}`
  + `${sp.capacity ? `[[${sixStr(sp.capacity, sp.capAt)}]]` : ''}`;

// Back to one string: capacity, size, spaces, nodes, then whatever else was
// there - the order ET-UNICA-8M-4K8 uses. A spaceList, when given, wins over the
// raw spaces body.
export function formatParams(p) {
  const bits = [];
  if (p.capacity) bits.push(`[[${sixStr(p.capacity, p.capacityAt)}]]`);
  if (p.size) bits.push(`[${sixStr(p.size, p.sizeAt)}]`);
  const spaces = p.spaceList?.length ? p.spaceList.map(formatSpace).join(',') : p.spaces;
  if (spaces) bits.push(`<${spaces}>`);
  if (p.nodes) bits.push(`{${p.nodes}}`);
  if (p.rest) bits.push(p.rest);
  return bits.join('');
}

// Write a size into a field without disturbing whatever else it holds.
export const withSize = (params, size) =>
  formatParams({ ...parseParams(params), size, sizeAt: null });

export const withCapacity = (params, capacity) =>
  formatParams({ ...parseParams(params), capacity, capacityAt: null });
