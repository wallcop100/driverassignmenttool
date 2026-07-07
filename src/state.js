export const keyOf = (driverRef, node) => `${driverRef}|${node}`;

// available cable-label fields (block face) — order here is display order
export const LABEL_FIELDS = [
  { key: 'ref', label: 'Ref' },
  { key: 'loadW', label: 'Load (W)' },
  { key: 'currentA', label: 'Current (A)' },
  { key: 'voltageV', label: 'Voltage (V)' },
  { key: 'fvV', label: 'fV' },
  { key: 'controlGroup', label: 'ControlGroup' },
  { key: 'location', label: 'Location' },
  { key: 'positionType', label: 'Position type' },
];
export const DEFAULT_PREFS = { label: ['loadW', 'fvV'] }; // current behaviour

export const initialState = {
  model: null,
  assignments: {},
  addedDrivers: [],
  undo: [],
  redo: [],
  flags: [],
  selectedLinks: [],    // link refs selected for click-move / best-fit (multi, #8)
  suggestions: null,    // Set of "driver|node" keys that would pass (derived from eligibility)
  draggingLink: null,   // link ref mid-drag, for ghost preview
  eligibility: null,    // {nodesByLink, impossibleByLink} for the current zone
  focusNode: null,      // "driver|node" — fill-this-node mode (reverse flow, #3)
  distributeGroup: null, // ControlGroup being distributed across marked nodes (#2)
  distributeNodes: [],   // node keys marked as distribution targets
  prefs: DEFAULT_PREFS, // persisted UI prefs (label config)
  demo: false,          // demo dataset loaded → show the tutorial
  view: { page: 'landing' },
};

const CLEAR_MODES = { selectedLinks: [], suggestions: null, focusNode: null, distributeGroup: null, distributeNodes: [] };

const cloneAssignments = (a) =>
  Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { ...v, refs: [...v.refs] }]));

// every mutation pushes the prior state onto undo and drops the redo stack
function withUndo(state, next) {
  return {
    ...state,
    ...next,
    undo: [...state.undo, { assignments: state.assignments, addedDrivers: state.addedDrivers }],
    redo: [],
  };
}

export function reducer(state, action) {
  switch (action.type) {
    case 'INIT':
      return {
        ...initialState,
        model: action.model,
        assignments: cloneAssignments(action.model.baseline),
        demo: !!action.demo,
      };

    case 'MOVE': {
      const { linkRef, toKey } = action; // toKey null = back to tray
      const target = state.assignments[toKey];
      if (toKey && target?.refs.length && target.toEntityType === 'Position') return state; // uniformity
      const assignments = cloneAssignments(state.assignments);
      for (const entry of Object.values(assignments)) {
        entry.refs = entry.refs.filter((r) => r !== linkRef);
      }
      if (toKey) {
        assignments[toKey] = assignments[toKey] ?? { toEntityType: '', refs: [] };
        assignments[toKey].refs.push(linkRef);
        assignments[toKey].toEntityType = 'Link';
      }
      return withUndo(state, { assignments, ...CLEAR_MODES });
    }

    case 'MOVE_MANY': {
      // move several links at once — a ControlGroup (#2) or a multi-selection (#8).
      const { linkRefs, toKey } = action; // toKey null = unassign all
      const target = state.assignments[toKey];
      if (toKey && target?.refs.length && target.toEntityType === 'Position') return state;
      const assignments = cloneAssignments(state.assignments);
      const moving = new Set(linkRefs);
      for (const entry of Object.values(assignments)) {
        entry.refs = entry.refs.filter((r) => !moving.has(r));
      }
      if (toKey) {
        assignments[toKey] = assignments[toKey] ?? { toEntityType: '', refs: [] };
        assignments[toKey].refs.push(...linkRefs);
        assignments[toKey].toEntityType = 'Link';
      }
      return withUndo(state, { assignments, ...CLEAR_MODES });
    }

    case 'DISTRIBUTE': {
      // spread a ControlGroup across the marked nodes (#2) — placements: {nodeKey: [refs]}
      const { placements } = action;
      const moving = new Set(Object.values(placements).flat());
      if (!moving.size) return { ...state, ...CLEAR_MODES };
      const assignments = cloneAssignments(state.assignments);
      for (const entry of Object.values(assignments)) entry.refs = entry.refs.filter((r) => !moving.has(r));
      for (const [key, refs] of Object.entries(placements)) {
        if (!refs.length) continue;
        assignments[key] = assignments[key] ?? { toEntityType: '', refs: [] };
        assignments[key].refs.push(...refs);
        assignments[key].toEntityType = 'Link';
      }
      return withUndo(state, { assignments, ...CLEAR_MODES });
    }

    case 'REVERT_KEY': {
      // reset one node back to the imported baseline (#5)
      const { key } = action;
      const assignments = cloneAssignments(state.assignments);
      const base = state.model.baseline[key];
      assignments[key] = base
        ? { toEntityType: base.toEntityType, refs: [...base.refs] }
        : { toEntityType: '', refs: [] }; // added-driver node has no baseline
      return withUndo(state, { assignments, ...CLEAR_MODES });
    }

    case 'ADD_DRIVER': {
      const { typeRef, zone } = action;
      const taken = new Set([
        ...state.model.drivers.map((d) => d.ref),
        ...state.addedDrivers.map((d) => d.ref),
      ]);
      let n = 90001;
      while (taken.has(`E${n}`)) n += 1;
      const ref = `E${n}`;
      const template = state.model.inventory.find((t) => t.typeRef === typeRef);
      const assignments = cloneAssignments(state.assignments);
      for (const node of template.nodes) {
        assignments[keyOf(ref, node.name)] = { toEntityType: '', refs: [] };
      }
      return withUndo(state, {
        assignments,
        addedDrivers: [...state.addedDrivers, { ref, typeRef, zone }],
      });
    }

    case 'UNDO': {
      if (!state.undo.length) return state;
      const prev = state.undo[state.undo.length - 1];
      const snap = { assignments: state.assignments, addedDrivers: state.addedDrivers };
      return { ...state, ...prev, undo: state.undo.slice(0, -1), redo: [...state.redo, snap], ...CLEAR_MODES };
    }

    case 'REDO': {
      if (!state.redo.length) return state;
      const nextS = state.redo[state.redo.length - 1];
      const snap = { assignments: state.assignments, addedDrivers: state.addedDrivers };
      return { ...state, ...nextS, redo: state.redo.slice(0, -1), undo: [...state.undo, snap], ...CLEAR_MODES };
    }

    case 'RESTORE': // full session restore from localStorage (#3)
      return {
        ...initialState,
        model: action.saved.model,
        assignments: action.saved.assignments,
        addedDrivers: action.saved.addedDrivers ?? [],
        prefs: { ...DEFAULT_PREFS, ...(action.saved.prefs ?? {}) },
        view: action.saved.view ?? { page: 'landing' },
      };

    case 'SET_PREFS':
      return { ...state, prefs: { ...state.prefs, ...action.prefs } };
    case 'SET_FLAGS':
      return { ...state, flags: action.flags };
    case 'SET_ELIGIBILITY':
      return { ...state, eligibility: action.eligibility };
    case 'SELECT_LINKS': {
      // additive (Ctrl/⌘) toggles; plain click selects one (or deselects if it was the only one)
      const { linkRef, additive } = action;
      const cur = state.selectedLinks;
      let selectedLinks;
      if (additive) selectedLinks = cur.includes(linkRef) ? cur.filter((r) => r !== linkRef) : [...cur, linkRef];
      else selectedLinks = cur.length === 1 && cur[0] === linkRef ? [] : [linkRef];
      return { ...state, ...CLEAR_MODES, selectedLinks };
    }
    case 'SET_SUGGESTIONS':
      return { ...state, suggestions: action.suggestions };
    case 'FOCUS_NODE':
      return { ...state, ...CLEAR_MODES, focusNode: state.focusNode === action.key ? null : action.key };
    case 'START_DISTRIBUTE': // toggle distribute mode for a ControlGroup
      return { ...state, ...CLEAR_MODES, distributeGroup: state.distributeGroup === action.group ? null : action.group };
    case 'TOGGLE_DIST_NODE': { // mark/unmark a node as a distribution target
      const marked = state.distributeNodes.includes(action.key)
        ? state.distributeNodes.filter((k) => k !== action.key)
        : [...state.distributeNodes, action.key];
      return { ...state, distributeNodes: marked };
    }
    case 'SET_DRAGGING':
      return { ...state, draggingLink: action.linkRef };
    case 'SET_VIEW':
      return { ...state, ...CLEAR_MODES, view: action.view };
    default:
      return state;
  }
}

// ---- derived helpers ----

export function effectiveDrivers(model, addedDrivers) {
  const byType = Object.fromEntries(model.inventory.map((t) => [t.typeRef, t]));
  return [
    ...model.drivers,
    ...addedDrivers.map((a) => ({ ...byType[a.typeRef], ref: a.ref, zone: a.zone, added: true })),
  ];
}

export function linksByRef(model) {
  return Object.fromEntries(model.links.map((l) => [l.ref, l]));
}

export function driverLoad(driver, assignments, links) {
  let total = 0;
  for (const node of driver.nodes) {
    for (const ref of assignments[keyOf(driver.ref, node.name)]?.refs ?? []) {
      total += links[ref]?.loadW ?? 0;
    }
  }
  return total;
}

export function assignedRefs(assignments) {
  const set = new Set();
  for (const entry of Object.values(assignments)) entry.refs.forEach((r) => set.add(r));
  return set;
}

export function isPending(key, assignments, baseline) {
  const now = assignments[key]?.refs ?? [];
  const was = baseline[key]?.refs ?? [];
  return now.length !== was.length || now.some((r, i) => r !== was[i]);
}

export function zoneStats(zone, model, assignments, addedDrivers, flags) {
  const links = linksByRef(model);
  const drivers = effectiveDrivers(model, addedDrivers).filter((d) => d.zone === zone);
  const refs = new Set(drivers.map((d) => d.ref));
  let load = 0;
  let capacity = 0;
  for (const d of drivers) {
    load += driverLoad(d, assignments, links);
    if (d.maxPowerW != null) capacity += d.maxPowerW;
  }
  // completion = share of ALL the zone's cables that are placed (incl. undetermined)
  const assigned = assignedRefs(assignments);
  const cables = model.links.filter((l) => l.zone === zone);
  const assignedCount = cables.filter((l) => assigned.has(l.ref)).length;
  const zoneFlags = flags.filter((f) => refs.has(f.driver));
  return {
    pct: capacity ? Math.round((100 * load) / capacity) : 0,
    completionPct: cables.length ? Math.round((100 * assignedCount) / cables.length) : 100,
    assignedCount,
    cableCount: cables.length,
    load,
    capacity,
    fails: zoneFlags.filter((f) => f.level === 'FAIL' || f.level === 'MISMATCH').length,
    warns: zoneFlags.filter((f) => f.level === 'WARN').length,
  };
}

// Tray drill-down filter (#9). Values: 'all' | 'CC' | 'CV' | 'A:<mA>' | 'V:<v>'.
// The same predicate drives which drivers stay visible (hide the rest).
const near = (a, b) => a != null && b != null && Math.abs(a - b) < 1e-6;
export function linkMatchesFilter(link, filter) {
  if (filter === 'all') return true;
  if (filter === 'CC' || filter === 'CV') return link.powerType === filter;
  if (filter.startsWith('A:')) return link.powerType === 'CC' && near(link.currentA, Number(filter.slice(2)));
  if (filter.startsWith('V:')) return link.powerType === 'CV' && near(link.voltageV, Number(filter.slice(2)));
  return true;
}
export function driverMatchesFilter(driver, filter) {
  if (filter === 'all' || driver.undetermined) return true; // undetermined = wildcard, always shown
  if (filter === 'CC' || filter === 'CV') return driver.powerType === filter;
  if (filter.startsWith('A:')) return driver.powerType === 'CC' && near(driver.currentA, Number(filter.slice(2)));
  if (filter.startsWith('V:')) return driver.powerType === 'CV' && near(driver.outputVoltageV, Number(filter.slice(2)));
  return true;
}
// Distinct filter options present among a zone's cables.
export function filterOptions(zoneLinks) {
  const currents = [...new Set(zoneLinks.filter((l) => l.powerType === 'CC' && l.currentA != null).map((l) => l.currentA))].sort((a, b) => a - b);
  const voltages = [...new Set(zoneLinks.filter((l) => l.powerType === 'CV' && l.voltageV != null).map((l) => l.voltageV))].sort((a, b) => a - b);
  return { currents, voltages };
}

// Provision/mains links (LV-PROV, N/A) have no secondary power type — they don't
// belong on normal secondary drivers, so they go in a separate tray lane (#6).
export function isProvision(link) {
  return !link.powerType;
}

// Driver status relative to the current selection (#1, #8): impossible if it
// can't take ANY selected link; candidate if it has a node eligible for ALL of
// them (intersection); else full (right type, no shared room).
export function driverStatus(driverRef, selectedLinks, eligibility) {
  if (!selectedLinks?.length || !eligibility) return 'neutral';
  if (selectedLinks.some((ref) => (eligibility.impossibleByLink[ref] ?? []).includes(driverRef))) return 'impossible';
  const sets = selectedLinks.map((ref) => new Set(eligibility.nodesByLink[ref] ?? []));
  const hasNode = [...sets[0]].some((k) => k.startsWith(`${driverRef}|`) && sets.every((s) => s.has(k)));
  return hasNode ? 'candidate' : 'full';
}

// Intersection of eligible nodes across the selection — the green "best-fit" set.
export function intersectionSuggestions(selectedLinks, eligibility) {
  if (!selectedLinks?.length || !eligibility) return null;
  const sets = selectedLinks.map((ref) => new Set(eligibility.nodesByLink[ref] ?? []));
  return new Set([...sets[0]].filter((k) => sets.every((s) => s.has(k))));
}

// Block-face text from the configured label fields (fixed display order).
export function labelText(link, fields) {
  const unit = { loadW: 'W', currentA: 'A', voltageV: 'V', fvV: 'fV' };
  const parts = [];
  for (const { key } of LABEL_FIELDS) {
    if (!fields.includes(key)) continue;
    const v = link[key];
    if (v == null || v === '') continue;
    parts.push(`${v}${unit[key] ?? ''}`);
  }
  return parts.length ? parts.join(' · ') : link.ref; // always show something
}

export function nodeCountFor(linkRef, eligibility) {
  return (eligibility?.nodesByLink?.[linkRef] ?? []).length;
}

// Tray links that could legally land on a focused node (#3, by inverting nodesByLink).
export function linksForNode(nodeKey, eligibility) {
  const out = new Set();
  for (const [ref, keys] of Object.entries(eligibility?.nodesByLink ?? {})) {
    if (keys.includes(nodeKey)) out.add(ref);
  }
  return out;
}

const fingerprintKey = (l) =>
  l.powerType === 'CC' ? `CC·${l.currentA ?? '?'}A`
    : l.powerType === 'CV' ? `CV·${l.voltageV ?? '?'}V`
    : 'other';

// Orphan links (no eligible node) clustered by electrical fingerprint, each matched
// to the inventory driver type that would accept them (#7).
export function orphanClusters(trayLinks, eligibility, inventory) {
  const clusters = {};
  for (const l of trayLinks) {
    if (l.powerType == null) continue; // provisions handled separately
    if (nodeCountFor(l.ref, eligibility) > 0) continue;
    const key = fingerprintKey(l);
    (clusters[key] ??= { key, powerType: l.powerType, currentA: l.currentA, voltageV: l.voltageV, links: [] })
      .links.push(l);
  }
  const matchType = (c) => inventory.find((t) => {
    if (t.powerType !== c.powerType) return false;
    if (c.powerType === 'CC' && c.currentA && t.currentA) return Math.abs(c.currentA - t.currentA) / t.currentA <= 0.10;
    if (c.powerType === 'CV' && c.voltageV && t.outputVoltageV) return Math.abs(c.voltageV - t.outputVoltageV) <= 0.5;
    return true;
  });
  return Object.values(clusters).map((c) => ({ ...c, type: matchType(c) }));
}

// Ordered around the colour wheel so neighbouring hubs get pleasantly distinct,
// well-spaced hues rather than random clashes.
const ACCENTS = [
  '#7C5CFC', '#3A86FF', '#2EC4B6', '#4CB944', '#FFC857', '#FF8A5B',
  '#EF476F', '#C74BD1', '#118AB2', '#06D6A0', '#F4A259', '#8338EC',
];
// Colour by hub name in sorted order (#) so the palette walks the wheel by zone.
export function zoneAccent(zone, zones) {
  const i = zones ? zones.indexOf(zone) : 0;
  return ACCENTS[(i < 0 ? 0 : i) % ACCENTS.length];
}

function hashHue(str) {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

// Deterministic per-ControlGroup colour — dozens of distinct hues, stable across
// sessions, so cables in the same group read as one colour and a split node pops.
export function cgColor(cg) {
  if (!cg) return { border: '#94a3b8', bg: '#eef2f7', text: '#64748b' };
  const hue = hashHue(cg);
  return {
    border: `hsl(${hue} 55% 42%)`,
    bg: `hsl(${hue} 68% 96%)`,
    text: `hsl(${hue} 55% 30%)`,
  };
}
