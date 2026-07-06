export const keyOf = (driverRef, node) => `${driverRef}|${node}`;

export const initialState = {
  model: null,
  assignments: {},
  addedDrivers: [],
  undo: [],
  flags: [],
  selectedLink: null,   // link ref selected for click-move / best-fit
  suggestions: null,    // Set of "driver|node" keys that would pass
  draggingLink: null,   // link ref mid-drag, for ghost preview
  view: { page: 'landing' },
};

const cloneAssignments = (a) =>
  Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { ...v, refs: [...v.refs] }]));

function withUndo(state, next) {
  return {
    ...state,
    ...next,
    undo: [...state.undo, { assignments: state.assignments, addedDrivers: state.addedDrivers }],
  };
}

export function reducer(state, action) {
  switch (action.type) {
    case 'INIT':
      return {
        ...initialState,
        model: action.model,
        assignments: cloneAssignments(action.model.baseline),
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
      return withUndo(state, { assignments, selectedLink: null, suggestions: null });
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
      return { ...state, ...prev, undo: state.undo.slice(0, -1), selectedLink: null, suggestions: null };
    }

    case 'SET_FLAGS':
      return { ...state, flags: action.flags };
    case 'SELECT_LINK':
      return { ...state, selectedLink: action.linkRef, suggestions: null };
    case 'SET_SUGGESTIONS':
      return { ...state, suggestions: action.suggestions };
    case 'SET_DRAGGING':
      return { ...state, draggingLink: action.linkRef };
    case 'SET_VIEW':
      return { ...state, view: action.view, selectedLink: null, suggestions: null };
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
  const zoneFlags = flags.filter((f) => refs.has(f.driver));
  return {
    pct: capacity ? Math.round((100 * load) / capacity) : 0,
    load,
    capacity,
    fails: zoneFlags.filter((f) => f.level === 'FAIL' || f.level === 'MISMATCH').length,
    warns: zoneFlags.filter((f) => f.level === 'WARN').length,
  };
}

const ACCENTS = [
  '#7C5CFC', '#FF8A5B', '#2EC4B6', '#FFC857', '#EF476F', '#118AB2',
  '#06D6A0', '#F78C6B', '#8338EC', '#3A86FF', '#FB5607', '#4CB944',
];
export function zoneAccent(zone) {
  let h = 0;
  for (const c of zone) h = (h * 31 + c.charCodeAt(0)) >>> 0; // stable across sessions
  return ACCENTS[h % ACCENTS.length];
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
