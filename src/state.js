import { nextDriverRef, outRef, sameRefs } from './engine.js';

// Added drivers all export as the same placeholder ref; outRef strips the
// internal tag that keeps them apart. Re-exported so components have one import.
export { outRef };

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
// label: current behaviour. The two sizing knobs live here so they survive a
// reload like every other UI pref.
// The estimate constraints default conservative: at tender stage a tight answer
// has quietly made design decisions nobody has taken yet.
export const DEFAULT_PREFS = {
  label: ['loadW', 'fvV'],
  restrictControlGroup: true,
  margin: 0.05,
  splitByType: true,
  splitByLocation: false,
  preferSingleOutput: true,
};

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
  presets: {},          // typeRef -> driver type preset patched/invented here
  demo: false,          // demo dataset loaded → show the tutorial
  deletedDrivers: [],   // refs of DesignDB drivers to mark IsDeleted in the patch
  fixNodeSyntax: false, // sweep banned ':' nodes out of LinksMap in the patch
  context: null,        // embed mode: { systemSetId, hubRef, hubLabel } from the host
  view: { page: 'landing' },
};

const CLEAR_MODES = { selectedLinks: [], suggestions: null, focusNode: null, distributeGroup: null, distributeNodes: [] };

const cloneAssignments = (a) =>
  Object.fromEntries(Object.entries(a).map(([k, v]) => [k, { ...v, refs: [...v.refs] }]));

// An existing ElementType in the shape a preset is held in, so a correction that
// only touches the node names leaves every rating exactly as the DesignDB has it.
const typeAsPreset = (t) => ({
  typeRef: t.typeRef,
  name: t.name ?? '',
  powerType: t.powerType ?? null,
  maxPowerW: t.maxPowerW ?? null,
  currentA: t.currentA ?? null,
  outputVoltageV: t.outputVoltageV ?? null,
  outputs: t.nodes?.length ?? 1,
  addresses: t.ballast ?? null,
  nodeNames: t.nodes?.map((n) => n.name) ?? null,
  nodeMaxLoadW: t.nodes?.[0]?.maxLoadW ?? null,
  nodeMaxFvV: t.nodes?.[0]?.maxFvV ?? null,
  nodeCurrentA: t.nodeCurrentA ?? null,
  controlType: t.controlType ?? null,
  invented: false,
});

// every mutation pushes the prior state onto undo and drops the redo stack
function withUndo(state, next) {
  return {
    ...state,
    ...next,
    undo: [...state.undo, {
      assignments: state.assignments,
      addedDrivers: state.addedDrivers,
      deletedDrivers: state.deletedDrivers,
    }],
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
        context: action.context ?? null,
        // Type corrections belong to the set, not the hub — the ones made in
        // another hub of this set arrive here already applied.
        presets: action.presets ?? {},
        // an estimate has no cables to assign, so it never lands on a zone
        view: action.view ?? (action.model.mode === 'estimate'
          ? { page: 'estimate' }
          : initialState.view),
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
      const ref = nextDriverRef(taken);
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

    // Removing a driver is two different things. One added here has no row in
    // the workbook yet, so it simply stops existing. One that is really in the
    // DesignDB cannot be un-added: the row is marked IsDeleted and patched, the
    // same way the workbook would have it done by hand.
    case 'REMOVE_DRIVER': {
      const { ref } = action;
      const added = state.addedDrivers.some((d) => d.ref === ref);
      const assignments = cloneAssignments(state.assignments);
      // its cables go back to the tray either way — a deleted driver cannot keep
      // them, and the patch has to repoint them somewhere
      for (const key of Object.keys(assignments)) {
        if (key.split('|')[0] === ref) delete assignments[key];
      }
      return withUndo(state, {
        assignments,
        addedDrivers: state.addedDrivers.filter((d) => d.ref !== ref),
        deletedDrivers: added ? state.deletedDrivers : [...new Set([...state.deletedDrivers, ref])],
      });
    }

    case 'RESTORE_DRIVER': {
      const { ref } = action;
      const driver = state.model.drivers.find((d) => d.ref === ref);
      const assignments = cloneAssignments(state.assignments);
      for (const node of driver?.nodes ?? []) {
        const key = keyOf(ref, node.name);
        assignments[key] = assignments[key] ?? { toEntityType: '', refs: [] };
      }
      return withUndo(state, {
        assignments,
        deletedDrivers: state.deletedDrivers.filter((r) => r !== ref),
      });
    }

    // Correct every banned ':' node on the job at once. A rename, not a move:
    // the node keeps its identity, so the cables on it stay on it — the
    // assignment keys are just re-spelled. The LinksMap half is swept across the
    // whole sheet by the patch, because a node written this way is used by hubs
    // this session has never opened.
    case 'FIX_NODE_SYNTAX': {
      const { types } = action;      // [{ typeRef, nodeNames }]
      if (!types.length) return state;
      const presets = { ...state.presets };
      const byType = new Map();
      for (const t of types) {
        const cur = state.model.inventory.find((x) => x.typeRef === t.typeRef);
        if (!cur) continue;
        byType.set(t.typeRef, t.nodeNames);
        presets[t.typeRef] = {
          ...(presets[t.typeRef] ?? typeAsPreset(cur)),
          typeRef: t.typeRef,
          nodeNames: t.nodeNames,
          outputs: t.nodeNames.length,
        };
      }
      // re-spell the assignment keys of every driver of those types
      const drivers = [...state.model.drivers, ...state.addedDrivers];
      const rename = new Map();
      for (const d of drivers) {
        const names = byType.get(d.typeRef);
        if (!names) continue;
        const old = state.model.inventory.find((x) => x.typeRef === d.typeRef)?.nodes ?? [];
        old.forEach((n, i) => {
          if (names[i] && names[i] !== n.name) rename.set(keyOf(d.ref, n.name), keyOf(d.ref, names[i]));
        });
      }
      const assignments = {};
      for (const [k, v] of Object.entries(state.assignments)) {
        assignments[rename.get(k) ?? k] = { ...v, refs: [...v.refs] };
      }
      return withUndo(state, { presets, assignments, fixNodeSyntax: true });
    }

    case 'APPLY_PLAN': {
      // A whole suggestion — drivers plus their cables — is ONE undo step: it was
      // one decision, and undoing it a driver at a time would be unusable.
      const { drivers, placements } = action;
      if (!drivers.length) return state;
      const byType = Object.fromEntries(state.model.inventory.map((t) => [t.typeRef, t]));
      const moving = new Set(Object.values(placements).flat());
      const assignments = cloneAssignments(state.assignments);
      for (const entry of Object.values(assignments)) entry.refs = entry.refs.filter((r) => !moving.has(r));
      for (const d of drivers) {
        for (const node of byType[d.typeRef]?.nodes ?? []) {
          assignments[keyOf(d.ref, node.name)] = { toEntityType: '', refs: [] };
        }
      }
      for (const [key, refs] of Object.entries(placements)) {
        assignments[key] = { toEntityType: refs.length ? 'Link' : '', refs: [...refs] };
      }
      return withUndo(state, {
        assignments,
        addedDrivers: [...state.addedDrivers, ...drivers],
        ...CLEAR_MODES,
      });
    }

    case 'UNDO': {
      if (!state.undo.length) return state;
      const prev = state.undo[state.undo.length - 1];
      const snap = {
        assignments: state.assignments,
        addedDrivers: state.addedDrivers,
        deletedDrivers: state.deletedDrivers,
      };
      return { ...state, ...prev, undo: state.undo.slice(0, -1), redo: [...state.redo, snap], ...CLEAR_MODES };
    }

    case 'REDO': {
      if (!state.redo.length) return state;
      const nextS = state.redo[state.redo.length - 1];
      const snap = {
        assignments: state.assignments,
        addedDrivers: state.addedDrivers,
        deletedDrivers: state.deletedDrivers,
      };
      return { ...state, ...nextS, redo: state.redo.slice(0, -1), undo: [...state.undo, snap], ...CLEAR_MODES };
    }

    case 'RESTORE': // full session restore from localStorage (#3)
      return {
        ...initialState,
        model: action.saved.model,
        assignments: action.saved.assignments,
        addedDrivers: action.saved.addedDrivers ?? [],
        deletedDrivers: action.saved.deletedDrivers ?? [],
        fixNodeSyntax: !!action.saved.fixNodeSyntax,
        prefs: { ...DEFAULT_PREFS, ...(action.saved.prefs ?? {}) },
        // the hub's own saved presets, plus any made in another hub since
        presets: { ...(action.saved.presets ?? {}), ...(action.presets ?? {}) },
        context: state.context, // host context outlives a resume
        // action.view pins where to land. Embedded that is the hub the host
        // opened this frame on: a resume must restore the *work*, not navigate
        // somewhere else, because the surrounding modal is hub-specific and the
        // user has no way back.
        view: action.view ?? action.saved.view ?? { page: 'landing' },
      };

    // Presets are catalogue-level, like prefs: they change what CAN be built, not
    // what has been. Keeping them out of the undo stack means Ctrl+Z stays about
    // cable moves, and a preset cannot be silently un-defined under a driver
    // that is using it.
    case 'SET_PRESET':
      return { ...state, presets: { ...state.presets, [action.preset.typeRef]: action.preset } };
    case 'DELETE_PRESET': {
      const presets = { ...state.presets };
      delete presets[action.typeRef];
      return { ...state, presets };
    }
    case 'SET_MODEL': // rebuilt with the current presets; assignments survive
      return { ...state, model: action.model };

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

export function effectiveDrivers(model, addedDrivers, deletedDrivers) {
  const byType = Object.fromEntries(model.inventory.map((t) => [t.typeRef, t]));
  const gone = new Set(deletedDrivers ?? []);
  return [
    ...model.drivers.filter((d) => !gone.has(d.ref)),
    ...(addedDrivers ?? []).map((a) => ({ ...byType[a.typeRef], ref: a.ref, zone: a.zone, added: true })),
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

// Order-insensitive: pulling a cable off a node and dropping it back leaves the
// row exactly as imported, so it must not read as pending.
export function isPending(key, assignments, baseline) {
  return !sameRefs(assignments[key]?.refs, baseline[key]?.refs);
}

// Every node that differs from the imported baseline, plus every node of a
// driver added in the UI. This is the "Review changes (N)" list; it is also the
// changeCount reported to an embedding host, so there is one definition.
export function diffRows(state) {
  const { assignments, addedDrivers, model } = state;
  const added = new Set(addedDrivers.map((d) => d.ref));
  const rows = [];
  const keys = new Set([...Object.keys(model.baseline), ...Object.keys(assignments)]);
  for (const key of [...keys].sort()) {
    const oldRefs = model.baseline[key]?.refs ?? [];
    const newRefs = assignments[key]?.refs ?? [];
    const isNew = added.has(key.split('|')[0]);
    if (isNew || !sameRefs(oldRefs, newRefs)) {
      rows.push({ key, oldRefs, newRefs, isNew });
    }
  }
  return rows;
}

// The same changes, one row per CABLE rather than per driver node. This is the
// shape the patch is written in — LinksMap is patched a link at a time, its
// FromLinkEndContext* repointed — and the shape people describe the work in:
// "L104 moved off D2 onto the new driver", not "D2.OP.1 lost L104".
export function linkDiffRows(state) {
  const { assignments, addedDrivers, model } = state;
  const added = new Set(addedDrivers.map((d) => d.ref));
  const placed = (map) => {
    const m = new Map();
    for (const [key, v] of Object.entries(map ?? {})) {
      for (const ref of v?.refs ?? []) m.set(ref, key);
    }
    return m;
  };
  const was = placed(model.baseline);
  const now = placed(assignments);
  const rows = [];
  for (const ref of [...new Set([...was.keys(), ...now.keys()])].sort()) {
    const from = was.get(ref) ?? null;
    const to = now.get(ref) ?? null;
    if (from === to) continue;
    rows.push({ ref, from, to, isNew: !!to && added.has(to.split('|')[0]) });
  }
  return rows;
}

// What the host's "N unsaved" means, and what the Review badge counts: cables
// moved plus types corrected. A type correction is a real edit to the workbook —
// counting only cables reported 0 changes on a session that had rewritten a
// driver's ratings, which reads as nothing to patch.
export function changeCount(state) {
  return linkDiffRows(state).length + provisionalTypes(state).length
    + (state.addedDrivers?.length ?? 0) + (state.deletedDrivers?.length ?? 0);
}

export function zoneStats(zone, model, assignments, addedDrivers, flags, deletedDrivers) {
  const links = linksByRef(model);
  const drivers = effectiveDrivers(model, addedDrivers, deletedDrivers).filter((d) => d.zone === zone);
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

// Worst level present in a flags list — single source of truth so driver/node/
// block severity can never drift out of sync (FAIL > MISMATCH > WARN > none).
// MISMATCH covers wrong CC/CV type, wrong CV voltage, and out-of-band CC current
// (mA) — all genuinely serious electrical mismatches, same rank as FAIL.
export function severityOf(flagsList) {
  if (flagsList.some((f) => f.level === 'FAIL')) return 'FAIL';
  if (flagsList.some((f) => f.level === 'MISMATCH')) return 'MISMATCH';
  if (flagsList.some((f) => f.level === 'WARN')) return 'WARN';
  return null;
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

// Types whose ratings were supplied here rather than read from DesignDB, with
// how many drivers now depend on each. Shown in Review so whoever runs the
// export knows a rating was supplied here rather than read from the DesignDB.
export function provisionalTypes(state) {
  const { presets, model, addedDrivers } = state;
  const all = [...model.drivers, ...addedDrivers];
  return Object.values(presets ?? {})
    .map((p) => ({
      typeRef: p.typeRef,
      invented: !!p.invented,
      drivers: all.filter((d) => d.typeRef === p.typeRef).length,
    }))
    .sort((a, b) => a.typeRef.localeCompare(b.typeRef));
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

// All distinct ControlGroups present in one zone's links, sorted — lets colour
// assignment spread hues evenly across however many groups actually exist there,
// instead of relying on hash luck to keep a handful of groups visually apart.
export function zoneControlGroups(model, zone) {
  return [...new Set(model.links.filter((l) => l.zone === zone && l.controlGroup).map((l) => l.controlGroup))].sort();
}

function hashHue(str) {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 360;
}

// ControlGroup colour. When the zone's full group list is known, each group gets
// an evenly-spaced hue around the wheel — maximally distinct for however many
// groups are present. Falls back to a stable hash-based hue without it.
export function cgColor(cg, groups) {
  if (!cg) return { border: '#94a3b8', bg: '#eef2f7', text: '#64748b' };
  let hue;
  if (groups && groups.length) {
    const i = groups.indexOf(cg);
    hue = i >= 0 ? Math.round((i / groups.length) * 360) : hashHue(cg);
  } else {
    hue = hashHue(cg);
  }
  return {
    border: `hsl(${hue} 62% 40%)`,
    bg: `hsl(${hue} 72% 95%)`,
    text: `hsl(${hue} 62% 27%)`,
  };
}
