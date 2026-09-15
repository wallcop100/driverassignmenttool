// What a driver module is made of, and where each part sits inside it.
//
// A CV driver is a wrapper: ET-CVR-D-24-2CH-01 holds a DC/DC driver and its
// supply. The DB already knows the parts - on set 108857 every one of its 31
// Elements has ET-CVR-01 and ET-CVR-PSU-24 as children - but those children are
// generated at commit (_EE rows), so nothing on them can say where they sit.
//
// So the arrangement lives on the wrapper TYPE, in the form page 1410108 gives a
// discrete space: its name is the part's role, its detail is the child type, and
// its size carries the translation.
//
//   <PSU(ET-CVR-PSU-24)[228mm,68mm,39mm,0,55mm,0],Driver(ET-CVR-01)[153mm,50mm,23mm,0,0,0]>
//
// Junction boxes are not Elements anywhere; they are an allowance, stated as
// spaces on the driver Element itself (entity Parameters override the type's).
//
// Where a module's parts come from, strongest first:
//   edited     typed here this session
//   spaces     the wrapper type's spaces, from the DB
//   children   the DB's child Elements, laid out by the house rule (not stored)
//   suggested  the datasheet pair the name resolves to
//   wrapper    nothing to go on
import { parseParams, formatParams } from '../core/params.js';

export const GAP = 5;
export const JB_SIZE = [80, 35, 40];
const JB = /^JB(\.|$)/i;

export const roleFromName = (name) => {
  const n = String(name ?? '');
  if (/^PSU/i.test(n)) return 'PSU';
  if (/^Driver/i.test(n)) return 'Driver';
  if (/^EM/i.test(n)) return 'EM';
  return null;
};

// A child type's role, from what it states before what its name suggests. A
// type with LED output nodes drives LEDs; one with an output voltage and no
// such nodes supplies one.
export function roleOf(type, spec = null) {
  const nodes = parseParams(type?.params ?? '').nodes ?? '';
  if (/(^|,)\s*<\s*OP/i.test(nodes)) return { role: 'Driver', origin: 'db' };
  if (type?.outputVoltageV != null && !nodes) return { role: 'PSU', origin: 'db' };
  const kind = spec?.kind ?? null;
  if (kind === 'supply') return { role: 'PSU', origin: 'datasheet' };
  if (kind === 'dcdc' || kind === 'driver') return { role: 'Driver', origin: 'datasheet' };
  if (/(^|-)EM(-|$)/i.test(type?.typeRef ?? '')) return { role: 'EM', origin: 'datasheet' };
  return { role: null, origin: 'missing' };
}

// A unique space name per part: PSU, Driver, Driver.2 ...
export function nameSpaces(parts) {
  const seen = {};
  return parts.map((p) => {
    const base = p.role ?? 'Part';
    seen[base] = (seen[base] ?? 0) + 1;
    return { ...p, space: p.space ?? (seen[base] === 1 ? base : `${base}.${seen[base]}`) };
  });
}

// The drawings' arrangement: the supply across the top, everything else side by
// side beneath it. Used when nothing states an arrangement; never stored as a rule.
export function houseArrange(parts) {
  const top = parts.filter((p) => p.role === 'PSU');
  const low = parts.filter((p) => p.role !== 'PSU');
  const out = [];
  let x = 0;
  for (const p of low) {
    out.push({ ...p, at: [x, 0, 0] });
    x += (p.size?.[0] ?? 0) + GAP;
  }
  const lowH = Math.max(0, ...low.map((p) => p.size?.[1] ?? 0));
  let y = lowH ? lowH + GAP : 0;
  for (const p of top) {
    out.push({ ...p, at: [0, y, 0] });
    y += (p.size?.[1] ?? 0) + GAP;
  }
  // keep the order they came in, so the editor's rows do not jump
  return parts.map((p) => out.find((o) => o === p || (o.space === p.space && o.typeRef === p.typeRef && o.label === p.label)) ?? p);
}

// The box around everything placed, and the deepest part.
export function envelope(parts) {
  const sized = parts.filter((p) => p.size);
  if (!sized.length) return null;
  const at = (p, i) => p.at?.[i] ?? 0;
  return [
    Math.max(...sized.map((p) => at(p, 0) + p.size[0])),
    Math.max(...sized.map((p) => at(p, 1) + p.size[1])),
    Math.max(...sized.map((p) => p.size[2] ?? 0)),
  ];
}

// The wrapper type's spaces, and back.
export const toSpaceList = (parts) => nameSpaces(parts).map((p) => ({
  name: p.space, detail: p.typeRef ?? null, size: p.size ?? null, at: p.size ? (p.at ?? [0, 0, 0]) : null,
}));

export function fromParams(params) {
  return (parseParams(params ?? '').spaceList ?? [])
    .filter((sp) => !JB.test(sp.name) && (sp.detail || sp.size))
    .map((sp) => ({
      space: sp.name, role: roleFromName(sp.name), typeRef: sp.detail ?? null,
      size: sp.size, at: sp.at ?? [0, 0, 0],
    }));
}

// The wrapper type's Parameters with its parts written in, its envelope as its
// size, and its nodes and anything else left as they were.
export function wrapperParams(current, parts) {
  const p = parseParams(current ?? '');
  const env = envelope(parts);
  return formatParams({ ...p, size: env ?? p.size, sizeAt: null, spaceList: toSpaceList(parts), spaces: null });
}

/**
 * The parts of one wrapper type.
 *   wrapper   { typeRef, name, params }                the wrapper ElementType
 *   children  [{ typeRef, quantity }]                   its child Elements, from the DB
 *   types     { [typeRef]: { name, params, outputVoltageV } }
 *   resolveSpec  name -> catalogue spec
 *   edited    parts typed here, or null
 */
export function partsFor({ wrapper, children = [], types = {}, resolveSpec = () => null, edited = null }) {
  if (edited?.length) return { source: 'edited', parts: edited };

  const stated = fromParams(wrapper?.params);
  if (stated.length) return { source: 'spaces', parts: stated };

  if (children.length) {
    const parts = [];
    for (const c of children) {
      const t = { ...(types[c.typeRef] ?? {}), typeRef: c.typeRef };
      const spec = resolveSpec(t.name || c.typeRef);
      const part = spec?.driver ?? spec?.supply ?? spec ?? null;
      const own = parseParams(t.params ?? '').size;
      const { role, origin: roleOrigin } = roleOf(t, part);
      for (let i = 0; i < Math.max(1, Math.round(c.quantity ?? 1)); i += 1) {
        parts.push({
          role, roleOrigin, typeRef: c.typeRef, label: part?.code ?? t.name ?? c.typeRef,
          size: own?.[0] > 0 && own?.[1] > 0 ? own : part?.sizeMm ?? null,
          sizeOrigin: own?.[0] > 0 && own?.[1] > 0 ? 'db' : part?.sizeMm ? 'datasheet' : 'missing',
        });
      }
    }
    return { source: 'children', parts: houseArrange(nameSpaces(parts)) };
  }

  const spec = resolveSpec(wrapper?.name || wrapper?.typeRef);
  if (spec?.driver && spec?.supply) {
    const parts = [
      { role: 'Driver', roleOrigin: 'datasheet', typeRef: null, label: spec.driver.code ?? spec.driver.name,
        size: spec.driver.sizeMm ?? null, sizeOrigin: spec.driver.sizeMm ? 'datasheet' : 'missing' },
      { role: 'PSU', roleOrigin: 'datasheet', typeRef: null, label: spec.supply.code ?? spec.supply.name,
        size: spec.supply.sizeMm ?? null, sizeOrigin: spec.supply.sizeMm ? 'datasheet' : 'missing' },
    ];
    return { source: 'suggested', parts: houseArrange(nameSpaces(parts)) };
  }
  return { source: 'wrapper', parts: [] };
}

// ---- junction boxes, as spaces on the driver Element --------------------------

// Stacked down the right of the parts beneath the supply, the way the drawings put them.
export function jbSpaces(count, parts) {
  const low = parts.filter((p) => p.role !== 'PSU' && p.size);
  const x = low.length ? Math.max(...low.map((p) => (p.at?.[0] ?? 0) + p.size[0])) + GAP : 0;
  return Array.from({ length: Math.max(0, count) }, (_, i) => ({
    name: `JB.${i + 1}`, detail: null, size: [...JB_SIZE], at: [x, i * JB_SIZE[1], 0],
  }));
}

// How many the Element states, or null when it states none and the default stands.
export function jbCount(params) {
  const list = parseParams(params ?? '').spaceList;
  if (!list) return null;
  const n = list.filter((sp) => JB.test(sp.name)).length;
  return n || (list.length ? null : 0);
}

// The Element's Parameters with its junction boxes written in. Zero writes none.
export function elementParams(current, count, parts) {
  const p = parseParams(current ?? '');
  const others = (p.spaceList ?? []).filter((sp) => !JB.test(sp.name));
  const list = [...others, ...jbSpaces(count, parts)];
  return formatParams({ ...p, spaceList: list, spaces: list.length ? null : null });
}

// The module the drawing places: every part and junction box with its corner,
// and the size of the whole.
export function compose(parts, jboxes = 0) {
  const kind = (role) => (role === 'PSU' ? 'psu' : role === 'Driver' ? 'driver' : role === 'EM' ? 'em' : 'part');
  const body = parts.filter((p) => p.size).map((p) => ({
    kind: kind(p.role), label: p.label ?? p.typeRef ?? p.space, full: p.typeRef ?? p.label,
    size: p.size, at: p.at ?? [0, 0, 0], space: p.space,
  }));
  const boxes = jbSpaces(jboxes, parts).map((sp, i) => ({
    kind: 'jbox', label: 'JUNCTION BOX', size: sp.size, at: sp.at, ref: `jb${i}`,
  }));
  const all = [...body, ...boxes];
  const size = envelope(all);
  return size ? { size, parts: all } : null;
}
