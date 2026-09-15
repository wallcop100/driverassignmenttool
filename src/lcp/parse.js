// Building an LCP model out of what the overlay sends.
//
// The shape is deliberately the same one the driver tool uses, because the
// screens are the same: a container with slots that links land on, grouped by a
// parent. Read it as:
//
//   zone      the PANEL          (a hub, over there)
//   driver    a MODULE in it     (a driver, over there)
//   node      a TERMINAL on it   (an output, over there)
//   link      a cable            (the same thing)
//
// Nothing is renamed to match, because renaming would fork every shared screen
// for the sake of a word. The domain pack supplies the words the user sees.
import { readCsv } from '../core/csv.js';
import { parseNodeList, parseSlotList } from '../core/nodes.js';
import { parseParams } from '../core/params.js';

const s = (v) => (v == null ? '' : String(v).trim());

// One row per module, carrying its panel denormalised - the same way the driver
// form carries Pullzone on every driver row.
const MODULE_COLS = ['ElementRef', 'ElementTypeRef', 'PanelRef'];

export function parseModules(text) {
  const { rows } = readCsv(text, MODULE_COLS, 'Modules');
  const panels = new Map();
  const modules = rows.map((r) => {
    const panelRef = s(r.PanelRef);
    if (!panels.has(panelRef)) {
      panels.set(panelRef, {
        ref: panelRef,
        name: s(r.PanelName) || panelRef,
        typeRef: s(r.PanelTypeRef),
        // what the panel type says it HAS; a panel with no recipe declares no
        // slots, and DJ 101676 skips those entirely rather than guessing
        slots: parseSlotList(parseParams(s(r.PanelParameters)).spaces ?? ''),
      });
    }
    return {
      ref: s(r.ElementRef),
      name: s(r.ElementName),
      typeRef: s(r.ElementTypeRef),
      zone: panelRef,
      // where it sits in the panel, if anybody has said yet
      slot: parseParams(s(r.ContextParameters)).spaces ?? null,
      nodes: [],
    };
  });
  return { modules, panels: [...panels.values()] };
}

// Module ElementTypes: the terminal recipe is the whole point of the row.
export function parseTypes(text) {
  if (!text?.trim()) return [];
  const { rows } = readCsv(text, ['Ref'], 'Module types', true);
  return rows.map((r) => {
    const p = parseParams(s(r.Parameters));
    return {
      typeRef: s(r.Ref),
      name: s(r.Name),
      nodes: parseNodeList(p.nodes ?? ''),
      sizeMm: p.size ?? null,
      slots: parseSlotList(p.spaces ?? ''),
    };
  });
}

export function parseLinks(text) {
  const { rows } = readCsv(text, ['LinkRef'], 'Links', true);
  return rows.map((r) => ({
    ref: s(r.LinkRef),
    name: s(r.LinkName),
    zone: s(r.PanelRef),
    controlGroup: s(r.ControlGroup) || null,
    loop: s(r.Loop) || null,
    controlType: s(r.ControlType) || null,
    // what the circuit draws, so an output limit can actually be checked
    loadW: r.LoadW == null || String(r.LoadW).trim() === '' ? null : Number(r.LoadW),
    // A DALI loop is ONE link carrying many fittings - see the note in
    // domain.js. These are the counts that belong to the loop, and the tool only
    // ever reports them when the host has worked them out; it cannot.
    devices: r.Devices == null || String(r.Devices).trim() === '' ? null : Number(r.Devices),
    ballasts: r.Ballasts == null || String(r.Ballasts).trim() === '' ? null : Number(r.Ballasts),
    topology: s(r.Topology) || null,
    // where the design already has it, so a finished panel reads back clean
    toRef: s(r.ToElementRef) || null,
    toNode: s(r.ToNode) || null,
  }));
}

export function buildModel(modulesText, linksText, typesText) {
  if (!modulesText?.trim()) throw new Error('No modules - nothing to arrange or assign.');
  const { modules, panels } = parseModules(modulesText);
  const library = parseTypes(typesText);
  const byType = new Map(library.map((t) => [t.typeRef, t]));
  const links = parseLinks(linksText);

  // A module's terminals come from its type. A type with no recipe has no
  // terminals to land a cable on, which is a fault to show, not a crash.
  for (const m of modules) {
    const t = byType.get(m.typeRef);
    m.nodes = (t?.nodes ?? []).map((n) => ({ ...n }));
    m.name = m.name || t?.name || '';
    m.sizeMm = t?.sizeMm ?? null;
    m.undetermined = !t || !t.nodes.length;
  }

  // What the design already says, as the baseline every diff is taken against.
  const baseline = {};
  const byRef = new Map(modules.map((m) => [m.ref, m]));
  for (const l of links) {
    if (!l.toRef || !byRef.has(l.toRef)) continue;
    const key = `${l.toRef}|${l.toNode ?? ''}`;
    (baseline[key] ??= { toEntityType: 'Link', refs: [] }).refs.push(l.ref);
  }

  return {
    zones: panels.map((p) => p.ref).sort(),
    panels,
    drivers: modules,               // the shared screens' word for a container
    links,
    baseline,
    originalRows: [],
    fieldnames: MODULE_COLS,
    requirements: [],
    mode: 'assign',
    modeReason: `${modules.length} modules in ${panels.length} panels`,
    inventory: library.sort((a, b) => a.typeRef.localeCompare(b.typeRef)),
  };
}
