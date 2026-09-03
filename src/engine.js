// Client-side port of the former Python sidecar (parsing + DriverHealthCheck
// validation + export). Pure functions — the renderer owns all state. Runs in
// the browser and under node (see test/engine.test.mjs).
import Papa from 'papaparse';

const CURRENT_TOLERANCE = 0.10;

// Tolerant of spacing and case around the separator. The strict form
// (/(\d+)W(\s\|\s(\d+)([AV]))?/) silently produced powerType:null on "180W|24V"
// or "180W | 24v", which reads downstream as "driver type undeclared" — the
// driver then matches nothing in the inventory and its cables report "nowhere
// to go". Exporters vary here; a whitespace difference must not look like
// missing data.
// mA is accepted and normalised to amps. The cells hold amps (schema page 137573)
// and so does this app, but the ref, the datasheets and half the humans say
// milliamps, so "50W | 350mA" turns up. It used to fail the unit group and read
// as "driver type undeclared" — which now means the type is refused for sizing
// and quietly disappears from the catalogue. Same class of bug as the spacing
// one above: a notation difference must not look like missing data.
const DRIVER_RE = /(?<Watts>\d+(\.\d+)?)\s*W(\s*\|\s*(?<Value>\d+(\.\d+)?)\s*(?<Unit>m?[AV]))?/i;
const NODE_FV_RE = /(?<FV>\d+(\.\d+)?)\s*fV/i;
const NODE_W_RE = /(?<W>\d+(\.\d+)?)\s*W/i;

// Only the signature columns are required — everything else is read defensively,
// so adding columns to future CSVs (or dropping optional ones) won't break old
// or new files (backwards/forwards compatible).
const FORM_ESSENTIAL = ['ElementRef', 'Node'];
const LINK_ESSENTIAL = ['LinkRef'];

// ---- helpers ----
const num = (v) => {
  if (v == null || String(v).trim() === '') return null;
  const f = Number(v);
  return Number.isNaN(f) ? null : f;
};
const g = (n) => (Number.isInteger(n) ? String(n) : String(+n.toFixed(6)));
const pct = (x) => `${Math.round(x * 100)}%`;
const s = (v) => (v == null ? '' : String(v).trim());

function readCsv(text, required, label, allowEmpty = false) {
  const { data, meta, errors } = Papa.parse(text, { header: true, skipEmptyLines: 'greedy' });
  if (!data.length && !allowEmpty) throw new Error(`${label}: file is empty or has no data rows`);
  if (!data.length) return { rows: [], fields: meta.fields ?? [] };
  const missing = required.filter((c) => !meta.fields.includes(c));
  if (missing.length) throw new Error(`${label}: missing column(s): ${missing.join(', ')}`);
  if (errors.length) throw new Error(`${label}: ${errors[0].message} (row ${errors[0].row})`);
  return { rows: data, fields: meta.fields };
}

// Autodetect which CSV a dropped file is, by its header signature. Order
// matters: form rows also carry ElementTypeRef, so the type library is only
// what has the type column WITHOUT the per-element one.
export function detectKind(text) {
  const { meta } = Papa.parse(text, { header: true, preview: 1 });
  const f = meta.fields || [];
  if (f.includes('LinkRef')) return 'links';
  if (f.includes('ElementRef') && f.includes('Node')) return 'form';
  // Before 'types': the assessment also names ElementTypes-ish columns, but only
  // it groups fittings by their secondary power destination.
  if (f.includes('Link_SecondaryPowerRef') && f.includes('SumPower')) return 'assessment';
  if (f.includes('ElementTypeRef')) return 'types';
  return null;
}

// Same refs, any order. Cables come back to a node in whatever order they were
// dropped, so an order-sensitive compare reports "changed" for a row that is
// electrically identical to the import — and then exports and patches it.
export function sameRefs(a, b) {
  const x = a || [];
  const y = b || [];
  return x.length === y.length && [...x].sort().join() === [...y].sort().join();
}

// ---- parsing ----
export function parseDriverRestrictions(raw) {
  const m = DRIVER_RE.exec(raw || '');
  if (!m) return { powerType: null, maxPowerW: null, currentA: null, outputVoltageV: null };
  const watts = Number(m.groups.Watts);
  const { Value } = m.groups;
  const Unit = m.groups.Unit?.toUpperCase(); // case-insensitive match above
  if (Unit === 'A') return { powerType: 'CC', maxPowerW: watts, currentA: Number(Value), outputVoltageV: null };
  if (Unit === 'MA') return { powerType: 'CC', maxPowerW: watts, currentA: Number(Value) / 1000, outputVoltageV: null };
  if (Unit === 'V') return { powerType: 'CV', maxPowerW: watts, currentA: null, outputVoltageV: Number(Value) };
  if (Unit === 'MV') return { powerType: 'CV', maxPowerW: watts, currentA: null, outputVoltageV: Number(Value) / 1000 };
  return { powerType: null, maxPowerW: watts, currentA: null, outputVoltageV: null };
}

export function parseNodeRestrictions(raw) {
  const w = NODE_W_RE.exec(raw || '');
  const fv = NODE_FV_RE.exec(raw || '');
  return { maxLoadW: w ? Number(w.groups.W) : null, maxFvV: fv ? Number(fv.groups.FV) : null };
}

// ---- driver type library ----
// The per-hub export carries no "Driver Restrictions": the hub rows name an
// ElementTypeRef and the ratings live in a type library exported once. This
// parses that library into inventory-shaped entries, joined on ElementTypeRef.
//
// Two row shapes are accepted, because the tool does not get to pick the
// exporter's: one row per type+Node (same shape as the form CSV, node limits
// per row), or one row per type with a channel count. Anything without a Node
// column is treated as the latter.
const TYPE_ESSENTIAL = ['ElementTypeRef'];
const channelCount = (row) => {
  const n = num(row.Channels ?? row.Nodes ?? row.NodeCount ?? row.ChannelCount);
  return n && n > 0 ? Math.floor(n) : 1;
};

// A library may state the ElementTypes columns outright instead of the composed
// "Driver Restrictions" string, and when it does they win — the composed form is
// order-dependent and loses the rating whenever a driver-level fV sits between
// the watts and it:
//
//   "50W | 0.35A"        -> CC, 50W, 0.35A
//   "50W | 55fV | 0.35A" -> undeclared
//
// which is one of the ways a type ends up unusable for sizing.
const hasExplicit = (row) => ['MaxPower(W)', 'CurrentRange', 'OutputVoltage(V)']
  .some((c) => num(row[c]) != null);

function explicitRatings(row) {
  const maxPowerW = num(row['MaxPower(W)']);
  const currentA = num(row.CurrentRange);
  const outputVoltageV = num(row['OutputVoltage(V)']);
  const powerType = currentA != null ? 'CC' : outputVoltageV != null ? 'CV' : null;
  const rating = powerType === 'CC' ? `${g(currentA)}A`
    : powerType === 'CV' ? `${g(outputVoltageV)}V` : null;
  return {
    powerType,
    maxPowerW,
    currentA: powerType === 'CC' ? currentA : null,
    outputVoltageV: powerType === 'CV' ? outputVoltageV : null,
    // composed for export, where the form CSV still carries the string form —
    // and composed in the order that survives a round trip
    driverRestrictions: maxPowerW == null ? ''
      : `${g(maxPowerW)}W${rating ? ` | ${rating}` : ''}`,
  };
}

function explicitNode(row) {
  const maxLoadW = num(row['NodeMaxPower(W)']);
  const maxFvV = num(row['NodeMaxForwardVoltage(fV)']);
  return { maxLoadW, maxFvV };
}

export function parseTypes(text) {
  const { rows } = readCsv(text, TYPE_ESSENTIAL, 'Driver Type CSV');
  const types = new Map();
  for (const row of rows) {
    const typeRef = s(row.ElementTypeRef);
    if (!typeRef) continue;
    const node = s(row.Node);
    const explicit = hasExplicit(row);
    if (!types.has(typeRef)) {
      const d = explicit ? explicitRatings(row) : parseDriverRestrictions(row['Driver Restrictions']);
      const nodeStr = s(row['Node Restrictions']);
      types.set(typeRef, {
        typeRef,
        name: s(row.ElementTypeName ?? row.Name ?? row.TypeName),
        powerType: d.powerType, maxPowerW: d.maxPowerW,
        currentA: d.currentA, outputVoltageV: d.outputVoltageV,
        undetermined: d.maxPowerW == null,
        driverRestrictions: explicit ? d.driverRestrictions : s(row['Driver Restrictions']),
        nodeRestrictions: nodeStr || composeNodeRestrictions(explicit ? explicitNode(row) : {}),
        ballast: num(row.BallastCountPerUoM),
        controlType: s(row.ControlType) || null,
        nodes: [],
      });
    }
    const t = types.get(typeRef);
    const n = explicit ? explicitNode(row) : parseNodeRestrictions(row['Node Restrictions']);
    if (node) {
      if (!t.nodes.some((x) => x.name === node)) t.nodes.push({ name: node, ...n });
    } else if (!t.nodes.length) {
      for (let i = 1; i <= channelCount(row); i += 1) t.nodes.push({ name: `OP.${i}`, ...n });
    }
  }
  return [...types.values()].sort((a, b) => a.typeRef.localeCompare(b.typeRef));
}

const composeNodeRestrictions = (n) => [
  n.maxLoadW != null ? `${g(n.maxLoadW)}W` : null,
  n.maxFvV != null ? `${g(n.maxFvV)}fV` : null,
].filter(Boolean).join(' | ');

// Fill each driver's blank ratings from its type. A value stated on the hub row
// is an explicit override and is left alone — which is also why loading a
// library can never change how existing (standalone) data behaves.
function applyTypes(drivers, library) {
  const byType = Object.fromEntries(library.map((t) => [t.typeRef, t]));
  for (const d of drivers) {
    const t = byType[d.typeRef];
    if (!t) continue;
    if (d.maxPowerW == null) {
      d.powerType = t.powerType;
      d.maxPowerW = t.maxPowerW;
      d.currentA = t.currentA;
      d.outputVoltageV = t.outputVoltageV;
      d.undetermined = t.undetermined;
      d.driverRestrictions = d.driverRestrictions || t.driverRestrictions;
    }
    for (const node of d.nodes) {
      const tn = t.nodes.find((x) => x.name === node.name) ?? t.nodes[0];
      if (!tn) continue;
      if (node.maxLoadW == null) node.maxLoadW = tn.maxLoadW;
      if (node.maxFvV == null) node.maxFvV = tn.maxFvV;
    }
  }
}

function parseForm(text) {
  const { rows, fields } = readCsv(text, FORM_ESSENTIAL, 'Driver Assignment CSV');
  const drivers = new Map();
  const baseline = {};
  rows.forEach((row, i) => {
    const ref = s(row.ElementRef);
    const node = s(row.Node);
    if (!ref) throw new Error(`Driver Assignment CSV: row ${i + 2} has no ElementRef`);
    const key = `${ref}|${node}`;
    if (key in baseline) throw new Error(`Driver Assignment CSV: duplicate ElementRef+Node row: ${key}`);

    if (!drivers.has(ref)) {
      const d = parseDriverRestrictions(row['Driver Restrictions']);
      drivers.set(ref, {
        ref, typeRef: row.ElementTypeRef, parentRef: row.ParentElementRef, zone: row.Pullzone,
        // Human names, when the exporter sends them. A ref identifies a driver;
        // a name is how anyone actually talks about one.
        name: s(row.ElementName ?? row.Name),
        typeName: s(row.ElementTypeName ?? row.TypeName),
        powerType: d.powerType, maxPowerW: d.maxPowerW, currentA: d.currentA, outputVoltageV: d.outputVoltageV,
        undetermined: d.maxPowerW == null,
        driverRestrictions: row['Driver Restrictions'], nodeRestrictions: row['Node Restrictions'],
        nodes: [],
      });
    }
    const n = parseNodeRestrictions(row['Node Restrictions']);
    drivers.get(ref).nodes.push({ name: node, maxFvV: n.maxFvV, maxLoadW: n.maxLoadW });

    const refs = s(row.ToEntityRefs).split(',').map((r) => r.trim()).filter(Boolean);
    baseline[key] = { toEntityType: s(row.ToEntityType), refs, controlGroup: s(row.ControlGroup) };
  });
  return { drivers: [...drivers.values()], baseline, originalRows: rows, fieldnames: fields };
}

// A hub with no cables yet is the circumstance the estimate mode exists for, so
// a header-only links file parses to nothing rather than throwing.
function parseLinks(text) {
  const { rows } = readCsv(text, LINK_ESSENTIAL, 'Links Assignment CSV', true);
  const links = [];
  const seen = new Set();
  rows.forEach((row, i) => {
    const ref = s(row.LinkRef);
    if (!ref) throw new Error(`Links Assignment CSV: row ${i + 2} has no LinkRef`);
    if (seen.has(ref)) throw new Error(`Links Assignment CSV: duplicate LinkRef: ${ref}`);
    seen.add(ref);
    const pt = s(row.SecondaryPowerType);
    links.push({
      ref, zone: row.PullZone, typeRef: row.LinkTypeRef,
      loadW: num(row['LinkSumPower(W)']), currentA: num(row.LinkCurrent),
      voltageV: num(row['LinkVoltage(V)']), fvV: num(row['LinkForwardVoltage(Vf)']),
      powerType: pt === 'CC' || pt === 'CV' ? pt : null,
      controlGroup: s(row.ControlGroupText), location: row.ToLocationName,
      positionType: s(row.PositionType), threadCount: s(row.ThreadCount), controlType: s(row.ControlType),
    });
  });
  return links;
}

// Which of the three modes the data puts us in, and why. The tool should not
// depend on which file someone happened to drop: the circumstance is what the
// data says — cables and drivers, cables alone, or neither.
//
//   assign      cables to place, drivers to place them on
//   greenfield  cables, but no drivers yet — size them, then place
//   estimate    no cables at all — count drivers from the Positions (DJ 100053)
//
// `reason` is written to be shown to a person, because being in the wrong mode
// is confusing and the fix is usually another CSV.
export function detectMode({ drivers = 0, links = 0, requirements = 0 } = {}) {
  if (links > 0) {
    return drivers > 0
      ? { mode: 'assign', reason: `${links} cables and ${drivers} drivers` }
      : { mode: 'greenfield', reason: `${links} cables, no drivers yet` };
  }
  if (requirements > 0) {
    return { mode: 'estimate', reason: `no cables yet — ${requirements} requirement rows from the Positions` };
  }
  return {
    mode: null,
    reason: drivers > 0
      ? 'drivers but no cables — run the Links Assignment, or DJ 100053 for a tender estimate'
      : 'nothing to work from — drop the Links Assignment CSV, or DJ 100053 for a tender estimate',
  };
}

// ---- requirement assessment (DJ 100053) ----
// At tender stage there are Positions and no Links, so nothing exists to assign.
// DJ 100053 "Control Requirement Assessment (for SP Positions)" rolls the
// fittings up per secondary-power destination and gives, per group, a quantity
// and the totals for it.
//
// A row is NOT a cable: it is N fittings that happen to share a hub, a
// ControlGroup and a fitting type. It carries the same field names a link does,
// so fingerprintCompatible and pickType work on it unchanged — plus `qty`, and
// the per-unit values that make it divisible across drivers.
const ASSESSMENT_ESSENTIAL = ['Link_SecondaryPowerRef', 'SumPower'];

export function parseAssessment(text) {
  const { rows } = readCsv(text, ASSESSMENT_ESSENTIAL, 'Requirement Assessment CSV');
  const out = [];
  rows.forEach((row, i) => {
    const zone = s(row.Link_SecondaryPowerRef);
    if (!zone) return;                       // 100053 already drops these; belt and braces
    const qty = num(row.SumQuantity) ?? 1;
    if (qty <= 0) return;                    // a parent replaced by its own children
    const pt = s(row['CC/CV']);
    const loadW = num(row.SumPower) ?? 0;
    const fvV = num(row.SumVf);
    out.push({
      ref: `R${i + 1}`,                      // requirements are not patched; the ref is for bookkeeping
      zone,
      qty,
      loadW,
      fvV,
      currentA: num(row.CC_Current),
      voltageV: num(row.CV_Voltage),
      powerType: pt === 'CC' || pt === 'CV' ? pt : null,
      controlGroup: s(row.ControlGrouptext),
      location: s(row.LocationName),
      positionType: s(row.PositionTypeRef),
      controlType: s(row.ControlTypeRef),
      addressCount: num(row.ControlAddressCount),
      // per fitting — what actually has to fit on a node
      wPer: loadW / qty,
      fvPer: fvV == null ? null : fvV / qty,
    });
  });
  if (!out.length) throw new Error('Requirement Assessment CSV: no rows with a secondary power destination');
  return out;
}

// The catalogue as the DESIGN states it: every type the hub rows use, plus the
// whole library. Where both describe a type the library supplies the ratings but
// the node list is whichever is longer — the same rule buildInventory uses, so an
// observed 2CH instance is not reduced to 1CH by a thinner library row.
function designInventory(drivers, library) {
  const inventory = buildInventory(drivers);
  for (const t of library) {
    const seen = inventory.get(t.typeRef);
    const merged = seen && seen.nodes.length > t.nodes.length ? { ...t, nodes: seen.nodes } : t;
    inventory.set(t.typeRef, { ...merged, name: t.name || seen?.name || '' });
  }
  return inventory;
}

function buildInventory(drivers) {
  const inv = new Map();
  for (const d of drivers) {
    const cur = inv.get(d.typeRef);
    if (!cur || d.nodes.length > cur.nodes.length) {
      inv.set(d.typeRef, {
        typeRef: d.typeRef, name: d.typeName, powerType: d.powerType, maxPowerW: d.maxPowerW,
        currentA: d.currentA, outputVoltageV: d.outputVoltageV, undetermined: d.undetermined,
        driverRestrictions: d.driverRestrictions, nodeRestrictions: d.nodeRestrictions, nodes: d.nodes,
      });
    }
  }
  return inv;
}

// Greenfield (links-only) export shape: exactly the columns exportCsv writes for
// a driver added in the UI, which is all a hub with no drivers can produce.
const DEFAULT_FIELDNAMES = [
  'Pullzone', 'ParentElementRef', 'ElementRef', 'ElementName', 'ElementTypeRef', 'ElementTypeName',
  'Driver Restrictions', 'Node Restrictions', 'CurrentNodePowerInfo', 'Node', 'ToEntityType',
  'ToEntityRefs', 'ControlGroup',
];
const EMPTY_FORM = { drivers: [], baseline: {}, originalRows: [], fieldnames: DEFAULT_FIELDNAMES };

// formText is optional: a hub can start with cables and no drivers at all — that
// is the case this tool exists to fix. Without it the type library is the only
// possible source of inventory, so it becomes required instead.
// `assessmentText` is the third mode: Positions rolled up by DJ 100053, with no
// links and no drivers anywhere. The model then carries requirements instead of
// links, and nothing downstream that assigns cables applies to it.
export function buildModel(formText, linksText, typesText, presets, assessmentText) {
  const presetTypes = (presets || []).map(presetToType);
  if (!formText?.trim() && !typesText?.trim() && !presetTypes.length) {
    throw new Error('No Driver Assignment CSV and no driver type library — nothing to build drivers from.');
  }
  const { drivers, baseline, originalRows, fieldnames } = formText?.trim() ? parseForm(formText) : EMPTY_FORM;
  const links = parseLinks(linksText);
  // A job can be part designed and part still at tender, so requirements sit
  // beside the cables rather than instead of them — mode is per hub.
  const requirements = assessmentText?.trim() ? parseAssessment(assessmentText) : [];
  const library = typesText ? parseTypes(typesText) : [];
  if (library.length) applyTypes(drivers, library);
  // Snapshot the design's own ratings BEFORE a preset rewrites the drivers.
  // buildInventory reads them back off the driver rows, so taking it afterwards
  // would record our own numbers as the design's — which is precisely the
  // confusion this exists to prevent.
  const designDB = designInventory(drivers, library);
  if (presetTypes.length) applyPresets(drivers, presetTypes);
  const zones = [...new Set([...drivers.map((d) => d.zone), ...links.map((l) => l.zone),
    ...requirements.map((r) => r.zone)])].sort();

  // The catalogue is the whole library plus any type only seen in the hub rows,
  // so a hub can be given a driver type it does not currently contain — the
  // per-hub payload alone could only ever offer what was already there.
  //
  // Where both describe a type, the library supplies the ratings but the node
  // list is whichever is longer — same rule buildInventory already uses, so an
  // observed 2CH instance is not reduced to 1CH by a thinner library row.
  const inventory = designInventory(drivers, library);
  // A preset overrides outright for SIZING, node list included: the channel count
  // was typed in, so a longer observed one is stale data. But what the DesignDB
  // said is kept beside it, because a preset on an existing type is a proposed
  // change and not a fact — the page has to be able to show the design's own
  // numbers rather than quietly showing ours in their place.
  for (const t of presetTypes) {
    const prior = designDB.get(t.typeRef) ?? null;
    inventory.set(t.typeRef, { ...t, designDB: prior, name: t.name || prior?.name || '' });
  }
  const seen = detectMode({ drivers: drivers.length, links: links.length, requirements: requirements.length });
  if (!seen.mode) throw new Error(`This hub has ${seen.reason}.`);
  return {
    zones, drivers, links, baseline, originalRows, fieldnames,
    requirements,
    mode: seen.mode,
    modeReason: seen.reason,
    inventory: [...inventory.values()].sort((a, b) => a.typeRef.localeCompare(b.typeRef)),
  };
}

// The estimate model. No links, no drivers, no baseline to diff against — the
// only shared ground with the other two modes is the inventory, which is where
// the sizing gets its parts.
export function buildEstimate(assessmentText, typesText, presets) {
  const requirements = parseAssessment(assessmentText);
  const presetTypes = (presets || []).map(presetToType);
  const library = typesText?.trim() ? parseTypes(typesText) : [];
  if (!library.length && !presetTypes.length) {
    throw new Error('No driver type library — nothing to size the estimate against.');
  }
  const inventory = new Map(library.map((t) => [t.typeRef, t]));
  for (const t of presetTypes) {
    const prior = inventory.get(t.typeRef) ?? null;
    inventory.set(t.typeRef, { ...t, designDB: prior, name: t.name || prior?.name || '' });
  }
  return {
    zones: [...new Set(requirements.map((r) => r.zone))].sort(),
    drivers: [], links: [], baseline: {}, originalRows: [], fieldnames: DEFAULT_FIELDNAMES,
    requirements,
    mode: 'estimate',
    modeReason: detectMode({ requirements: requirements.length }).reason,
    inventory: [...inventory.values()].sort((a, b) => a.typeRef.localeCompare(b.typeRef)),
  };
}

// ---- validation (port of DriverHealthCheck.sql, 7 checks) ----
function makeCtx(model) {
  return {
    model,
    linksByRef: Object.fromEntries(model.links.map((l) => [l.ref, l])),
    inventoryByType: Object.fromEntries(model.inventory.map((t) => [t.typeRef, t])),
  };
}

function materializeAdded(ctx, added) {
  return (added || []).flatMap((a) => {
    const t = ctx.inventoryByType[a.typeRef];
    return t ? [{ ...t, ref: a.ref, zone: a.zone, parentRef: '', added: true }] : [];
  });
}
const effectiveDrivers = (ctx, added) => [...ctx.model.drivers, ...materializeAdded(ctx, added)];

function validateDriver(ctx, assignments, driver) {
  const flags = [];
  const flag = (level, check, message, node = null, link = null) =>
    flags.push({ driver: driver.ref, node, link, level, check, message });

  const perNode = {};
  for (const node of driver.nodes) {
    const entry = assignments[`${driver.ref}|${node.name}`] || {};
    const refs = entry.refs || [];
    perNode[node.name] = refs.filter((r) => ctx.linksByRef[r]).map((r) => ctx.linksByRef[r]);
    const unknown = refs.filter((r) => !ctx.linksByRef[r]);
    if (unknown.length) flag('WARN', 'EntityLoad', `no load data for ${unknown.join(', ')} (not in Links CSV)`, node.name);
  }
  const allLinks = Object.values(perNode).flat();
  if (!allLinks.length) return flags;

  // 1. Driver Type Match
  if (driver.powerType == null) {
    flag('WARN', 'TypeMatch', 'driver CC/CV type undeclared — type match not verified');
  } else {
    for (const [nn, links] of Object.entries(perNode)) {
      for (const l of links) {
        if (l.powerType && l.powerType !== driver.powerType) {
          flag('MISMATCH', 'TypeMatch', `${l.ref} is ${l.powerType} on a ${driver.powerType} driver`, nn, l.ref);
        }
      }
    }
  }

  // 2. CV Voltage
  if (driver.powerType === 'CV') {
    if (driver.outputVoltageV == null) {
      flag('WARN', 'CVVoltage', 'output voltage undeclared — voltage not verified');
    } else {
      for (const [nn, links] of Object.entries(perNode)) {
        for (const l of links) {
          if (!l.voltageV) flag('WARN', 'CVVoltage', `${l.ref} has no voltage data — voltage not verified`, nn, l.ref);
          else if (Math.abs(l.voltageV - driver.outputVoltageV) > 1e-6) {
            flag('MISMATCH', 'CVVoltage', `${l.ref} is ${g(l.voltageV)}V, driver outputs ${g(driver.outputVoltageV)}V`, nn, l.ref);
          }
        }
      }
    }
  }

  // 3. Driver total wattage + 4. no-split single ref
  const total = allLinks.reduce((sum, l) => sum + (l.loadW ?? 0), 0);
  if (driver.maxPowerW == null) {
    flag('WARN', 'TotalWattage', `MaxPower undeclared — ${g(total)}W assigned, not verified`);
  } else {
    if (total > driver.maxPowerW) flag('FAIL', 'TotalWattage', `total ${g(total)}W exceeds MaxPower ${g(driver.maxPowerW)}W`);
    if (driver.nodes.length === 1) {
      for (const [nn, links] of Object.entries(perNode)) {
        for (const l of links) {
          if (l.loadW != null && l.loadW > driver.maxPowerW) {
            flag('FAIL', 'NoSplit', `${l.ref} alone (${g(l.loadW)}W) exceeds MaxPower ${g(driver.maxPowerW)}W on a 1CH driver`, nn, l.ref);
          }
        }
      }
    }
  }

  // 3b. Per-node wattage cap
  for (const node of driver.nodes) {
    const links = perNode[node.name];
    if (node.maxLoadW == null || !links.length) continue;
    const nodeTotal = links.reduce((sum, l) => sum + (l.loadW ?? 0), 0);
    if (nodeTotal > node.maxLoadW) flag('FAIL', 'NodeWattage', `node load ${g(nodeTotal)}W exceeds node max ${g(node.maxLoadW)}W`, node.name);
  }

  // 5. Series forward voltage
  for (const node of driver.nodes) {
    const links = perNode[node.name];
    if (!links.length || node.maxFvV == null) continue;
    const known = links.map((l) => l.fvV).filter((v) => v != null);
    if (known.length < links.length) flag('WARN', 'SeriesFV', 'forward voltage missing on some links — fV not verified', node.name);
    const sumFv = known.reduce((a, b) => a + b, 0);
    if (sumFv > node.maxFvV) flag('FAIL', 'SeriesFV', `series fV ${g(sumFv)} exceeds node max ${g(node.maxFvV)}fV`, node.name);
  }

  // 6. Current match (CC, 10% band)
  if (driver.powerType === 'CC') {
    if (driver.currentA == null) {
      flag('WARN', 'CurrentMatch', 'current range undeclared — current not verified');
    } else {
      for (const [nn, links] of Object.entries(perNode)) {
        const currents = links.map((l) => l.currentA).filter((c) => c != null);
        if (!currents.length) continue; // CC cables need not carry current data — nothing to verify
        const lo = Math.min(...currents);
        const hi = Math.max(...currents);
        if (hi - lo > 1e-6) { flag('MISMATCH', 'CurrentMatch', `non-uniform link currents (${g(lo)}–${g(hi)}A) — mixed fixture types`, nn); continue; }
        const delta = Math.abs(currents[0] - driver.currentA) / driver.currentA;
        if (delta > CURRENT_TOLERANCE) flag('MISMATCH', 'CurrentMatch', `link current ${g(currents[0])}A deviates ${pct(delta)} from driver ${g(driver.currentA)}A`, nn);
        else if (delta > 0) flag('WARN', 'CurrentMatch', `link current ${g(currents[0])}A is ${pct(delta)} off ${g(driver.currentA)}A (expected input-power margin)`, nn);
      }
    }
  }

  // 7. ControlGroup uniformity
  for (const [nn, links] of Object.entries(perNode)) {
    const groups = [...new Set(links.map((l) => l.controlGroup).filter(Boolean))].sort();
    if (groups.length > 1) flag('FAIL', 'ControlGroup', `node serves multiple ControlGroups: ${groups.join(', ')}`, nn);
  }

  return flags;
}

export function validate(model, assignments, added) {
  const ctx = makeCtx(model);
  return effectiveDrivers(ctx, added).flatMap((d) => validateDriver(ctx, assignments || {}, d));
}

export function fingerprintCompatible(link, driver) {
  if (driver.undetermined) return true;
  if (link.powerType && driver.powerType && link.powerType !== driver.powerType) return false;
  if (driver.powerType === 'CC' && link.currentA && driver.currentA
    && Math.abs(link.currentA - driver.currentA) / driver.currentA > CURRENT_TOLERANCE) return false;
  if (driver.powerType === 'CV' && link.voltageV && driver.outputVoltageV
    && Math.abs(link.voltageV - driver.outputVoltageV) > 0.5) return false;
  return true;
}

function suggestCtx(ctx, linkRef, assignments) {
  const link = ctx.linksByRef[linkRef];
  if (!link) return [];
  const targets = [];
  for (const driver of ctx._drivers) {
    if (driver.zone !== link.zone) continue;
    for (const node of driver.nodes) {
      const key = `${driver.ref}|${node.name}`;
      const entry = assignments[key] || {};
      if (entry.refs?.length && entry.toEntityType === 'Position') continue;
      const trial = { ...assignments };
      for (const [k, v] of Object.entries(assignments)) {
        if (v.refs?.includes(linkRef)) trial[k] = { ...v, refs: v.refs.filter((r) => r !== linkRef) };
      }
      trial[key] = { toEntityType: 'Link', refs: [...(trial[key]?.refs || []), linkRef] };
      const bad = validateDriver(ctx, trial, driver).some((f) => f.level === 'FAIL' || f.level === 'MISMATCH');
      if (!bad) targets.push({ driver: driver.ref, node: node.name });
    }
  }
  return targets;
}

export function eligibility(model, zone, assignments, added) {
  const ctx = makeCtx(model);
  ctx._drivers = effectiveDrivers(ctx, added);
  const zoneDrivers = ctx._drivers.filter((d) => d.zone === zone);
  const nodesByLink = {};
  const impossibleByLink = {};
  for (const link of model.links.filter((l) => l.zone === zone)) {
    nodesByLink[link.ref] = suggestCtx(ctx, link.ref, assignments || {}).map((t) => `${t.driver}|${t.node}`);
    impossibleByLink[link.ref] = zoneDrivers.filter((d) => !fingerprintCompatible(link, d)).map((d) => d.ref);
  }
  return { nodesByLink, impossibleByLink };
}

// Distribute a set of cables across marked nodes, capacity-aware and *even* (#2):
// each cable (largest first) goes to the least-loaded eligible node (water-filling),
// respecting node watt/fV limits and the driver total, skipping incompatible nodes.
// Returns placements per node + anything that didn't fit.
// `margin` (0–1) is headroom kept free on every cap — a driver run at its rated
// maximum has nothing left for the next design revision, and real parts derate.
export function distributeGroup(model, assignments, added, linkRefs, nodeKeys, margin = 0) {
  const ctx = makeCtx(model);
  const byRef = Object.fromEntries(effectiveDrivers(ctx, added).map((d) => [d.ref, d]));
  const a = assignments || {};
  const loadOf = (key) => (a[key]?.refs || []).map((r) => ctx.linksByRef[r]).filter(Boolean);
  const info = {};
  const usedW = {};
  const usedFv = {};
  const count = {};
  const capW = {};
  const capFv = {};
  const drvUsedW = {};
  const drvCap = {};
  const derate = (v) => (v == null ? Infinity : v * (1 - margin));

  for (const key of nodeKeys) {
    const [dref, nname] = key.split('|');
    const driver = byRef[dref];
    const node = driver?.nodes.find((n) => n.name === nname);
    if (!node) continue;
    info[key] = { driver, node };
    const placed = loadOf(key);
    usedW[key] = placed.reduce((s, l) => s + (l.loadW ?? 0), 0);
    usedFv[key] = placed.reduce((s, l) => s + (l.fvV ?? 0), 0);
    count[key] = placed.length;
    capW[key] = derate(node.maxLoadW);
    capFv[key] = derate(node.maxFvV);
    if (drvCap[dref] === undefined) {
      drvCap[dref] = derate(driver.maxPowerW);
      drvUsedW[dref] = driver.nodes.reduce((s, n) => s + loadOf(`${dref}|${n.name}`).reduce((t, l) => t + (l.loadW ?? 0), 0), 0);
    }
  }

  const cables = linkRefs.map((r) => ctx.linksByRef[r]).filter(Boolean).sort((x, y) => (y.loadW ?? 0) - (x.loadW ?? 0));
  const placements = {};
  const unplaced = [];
  for (const cable of cables) {
    const w = cable.loadW ?? 0;
    const fv = cable.fvV ?? 0;
    let best = null;
    for (const key of nodeKeys) {
      const it = info[key];
      if (!it || !fingerprintCompatible(cable, it.driver)) continue;
      if (usedW[key] + w > capW[key] || usedFv[key] + fv > capFv[key] || drvUsedW[it.driver.ref] + w > drvCap[it.driver.ref]) continue;
      // even spread: prefer the least-loaded eligible node, then the one with fewer cables
      if (best === null || usedW[key] < usedW[best] - 1e-9
        || (Math.abs(usedW[key] - usedW[best]) <= 1e-9 && count[key] < count[best])) best = key;
    }
    if (best === null) { unplaced.push(cable.ref); continue; }
    (placements[best] ??= []).push(cable.ref);
    usedW[best] += w;
    usedFv[best] += fv;
    count[best] += 1;
    drvUsedW[info[best].driver.ref] += w;
  }
  return { placements, unplaced };
}

// ---- driver type presets (patched or invented in the UI) ----
// The type library is exported from DesignDB and is often thinner than the
// hardware: a type that declares only "185W" can hold cables but can't be sized
// against (see sizingCandidates). A preset is the missing declaration, supplied
// by a human here and patched back into the ElementTypes sheet.
// OP.n is the house convention, but a type that already names its outputs keeps
// those names: the preset is a statement about ratings, not about node identity,
// and renaming a node would strand every Element pointing at the old one.
// `channels` is the old shape, kept readable so a saved session restores.
const outputsOf = (p) => Math.max(1, Math.floor(p.outputs ?? p.channels ?? 1));
const nodeList = (p) => Array.from(
  { length: outputsOf(p) },
  (_, i) => ({
    name: p.nodeNames?.[i] ?? `OP.${i + 1}`,
    maxLoadW: p.nodeMaxLoadW ?? null,
    maxFvV: p.nodeMaxFvV ?? null,
  }),
);

// Restriction strings are composed, not stored: exportCsv writes them into the
// form CSV for added drivers, so a preset has to look exactly like a library row.
export function presetToType(p) {
  const rating = p.powerType === 'CC' && p.currentA != null ? `${g(p.currentA)}A`
    : p.powerType === 'CV' && p.outputVoltageV != null ? `${g(p.outputVoltageV)}V` : null;
  return {
    typeRef: p.typeRef,
    name: p.name ?? '',
    powerType: p.powerType ?? null,
    maxPowerW: p.maxPowerW ?? null,
    currentA: p.powerType === 'CC' ? p.currentA ?? null : null,
    outputVoltageV: p.powerType === 'CV' ? p.outputVoltageV ?? null : null,
    undetermined: p.maxPowerW == null,
    driverRestrictions: p.maxPowerW == null ? ''
      : `${g(p.maxPowerW)}W${rating ? ` | ${rating}` : ''}`,
    nodeRestrictions: [
      p.nodeMaxLoadW != null ? `${g(p.nodeMaxLoadW)}W` : null,
      p.nodeMaxFvV != null ? `${g(p.nodeMaxFvV)}fV` : null,
    ].filter(Boolean).join(' | '),
    nodes: nodeList(p),
    // Straight from the datasheet when the preset came from the catalogue;
    // undefined on a hand-typed one, and then simply not written.
    nodeCurrentA: p.nodeCurrentA ?? null,
    // DALI addresses, which is what a ref's nCH counts — NOT the output count.
    // A SoloDrive 560/A is two outputs on one address.
    ballast: p.addresses ?? p.ballast ?? null,
    controlType: p.controlType ?? null,
    preset: true,
    invented: !!p.invented,
  };
}

// A preset is an explicit human statement, so unlike the library it OVERWRITES
// rather than fills blanks — including on drivers already in the hub. Patching
// a type and then watching its five existing drivers keep warning would read as
// the patch not having worked.
function applyPresets(drivers, presetTypes) {
  const byType = Object.fromEntries(presetTypes.map((t) => [t.typeRef, t]));
  for (const d of drivers) {
    const t = byType[d.typeRef];
    if (!t) continue;
    d.powerType = t.powerType;
    d.maxPowerW = t.maxPowerW;
    d.currentA = t.currentA;
    d.outputVoltageV = t.outputVoltageV;
    d.undetermined = t.undetermined;
    d.driverRestrictions = t.driverRestrictions || d.driverRestrictions;
    for (const node of d.nodes) {
      const tn = t.nodes.find((x) => x.name === node.name) ?? t.nodes[0];
      if (!tn) continue;
      node.maxLoadW = tn.maxLoadW;
      node.maxFvV = tn.maxFvV;
    }
  }
}

// Datasheet-backed parts, from the Driver Specs page group. Offered in the
// editor as a starting point, and used to check what someone types against what
// the part actually is. See catalogue.js.
export { PARTS, combine, matchPart, matchParts, resolveSpec, reachableW } from './catalogue.js';

// A CC part's datasheet gives a RANGE; the design picks one value out of it and
// says so twice — in the ref (ET-CCR-D-1050-…) and in the name ("at 1050mA").
// nextTypeRef below writes that convention; these two read it back.
//
// Both return amps, or null when there is nothing to read. They are deliberately
// narrow: a number that is not clearly a milliamp figure is not guessed at.
// CCR only: the same slot on a CVR ref is the output VOLTAGE, so reading it as
// milliamps turns ET-CVR-D-24-2CH-01 into 0.024A.
const REF_MA = /^ET-CCR-[A-Z]+-(\d{2,4})-/i;
export function currentFromRef(typeRef) {
  const m = REF_MA.exec(String(typeRef ?? ''));
  return m ? Number(m[1]) / 1000 : null;
}

const NAME_MA = /(\d{2,4})\s*mA/i;
export function currentFromName(name) {
  const m = NAME_MA.exec(String(name ?? ''));
  return m ? Number(m[1]) / 1000 : null;
}

// Which mode a single hub is in. The overlay already decides this per hub — it
// sends links for a hub that has cables and an assessment for one that does not
// — so a model holding both is the honest shape, and a job can be part designed
// and part still at tender.
export function zoneMode(model, zone) {
  const links = (model.links || []).filter((l) => l.zone === zone).length;
  if (links) {
    const drivers = (model.drivers || []).filter((d) => d.zone === zone).length;
    return drivers ? 'assign' : 'size';
  }
  if ((model.requirements || []).some((r) => r.zone === zone)) return 'estimate';
  return null;
}

// The ref IS the spec in this library (ET-CCR-D-350-2CH-01 = CC, 350mA, 2CH), so
// the next free one is composed from the ratings being entered rather than a
// counter. A sibling's stem wins when there is one: naming is per-project and
// the library's own convention beats anything hardcoded here.
export function nextTypeRef(inventory, draft) {
  const { powerType, currentA, outputVoltageV, stem: given } = draft || {};
  // nCH is DALI addresses. Falls back to the output count only because most
  // parts have one address per output and a draft may not have said yet.
  const channels = draft?.addresses ?? draft?.channels ?? draft?.outputs;
  const mA = currentA != null ? Math.round(currentA * 1000) : null;
  const rating = powerType === 'CV' ? outputVoltageV : mA;
  if (!powerType || rating == null || !channels) return '';
  const inv = inventory || [];
  const sibling = inv.find((t) => t.powerType === powerType
    && (t.ballast ?? t.nodes.length) === Math.floor(channels)
    && !isEmergency(t.typeRef)
    && (powerType === 'CV'
      ? t.outputVoltageV === outputVoltageV
      : t.currentA != null && Math.round(t.currentA * 1000) === mA));
  const stem = given || (sibling ? sibling.typeRef.replace(/-\d+$/, '')
    : `ET-${powerType === 'CV' ? 'CVR' : 'CCR'}-D-${g(rating)}-${Math.floor(channels)}CH`);
  const taken = new Set(inv.map((t) => t.typeRef));
  for (let n = 1; n <= 99; n += 1) {
    const ref = `${stem}-${String(n).padStart(2, '0')}`;
    if (!taken.has(ref)) return ref;
  }
  return `${stem}-XX`;
}

// ---- driver sizing (greenfield / bulk add) ----
// Placeholder ref for a driver that doesn't exist in DesignDB yet. Deliberately
// not a number: it is resolved by a human later, and a made-up ElementRef that
// looks real is worse than one that obviously isn't. EVERY added driver exports
// as this same literal ref — they are all "to be allocated", and numbering them
// would imply an order DesignDB never agreed to.
export const PLACEHOLDER_REF = 'E5000X';

// Internally they still need to be told apart — assignments, flags and the whole
// UI are keyed by ref — so a second one carries a `~2` tag that never leaves the
// app: outRef() strips it on the way out (export, patch, on-screen labels).
// ponytail: string tag rather than a separate id field; a real id would mean
// touching every ref-keyed map in the app for zero user-visible gain.
export const outRef = (ref) => String(ref).split('~')[0];

export function nextDriverRef(taken) {
  if (!taken.has(PLACEHOLDER_REF)) return PLACEHOLDER_REF;
  let n = 2;
  while (taken.has(`${PLACEHOLDER_REF}~${n}`)) n += 1;
  return `${PLACEHOLDER_REF}~${n}`;
}

const fpKey = (l) => (l.powerType === 'CC' ? `CC·${g(l.currentA ?? 0)}A` : `CV·${g(l.voltageV ?? 0)}V`);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

// Emergency drivers are stock for the emergency circuit, not spare capacity —
// they lose every tie against an ordinary type that fits just as well.
// ponytail: recognised by ref, the only signal the export carries.
const isEmergency = (ref) => /(^|[-_ ])EM([-_ ]|\d|$)/i.test(String(ref));

// Sizing is only as honest as the ratings, so a type has to DECLARE them to be a
// candidate: CC/CV, its current or output voltage, and a max power. An
// undeclared type passes every compatibility test by default and its blank node
// limits read as infinite — that made the least-documented type in the library
// win every bucket (most watts, no fV ceiling, so always the fewest drivers).
// It is still fine to *hold* cables (validation only warns); it is not fine to
// recommend buying one.
function sizingCandidates(inventory, links) {
  return inventory.filter((t) => {
    if (!t.powerType || t.maxPowerW == null || !t.nodes.length) return false;
    if (t.powerType === 'CC' && t.currentA == null) return false;
    if (t.powerType === 'CV' && t.outputVoltageV == null) return false;
    return links.every((l) => l.powerType === t.powerType && fingerprintCompatible(l, t));
  });
}

// Choose the type that needs the fewest drivers for this bucket, then an
// ordinary type over an emergency one, then the one that wastes the least
// capacity. Types that can't take the single biggest cable are out — no amount
// of them would ever fit it.
// fewest drivers → ordinary before emergency → least wasted capacity
const betterFit = (a, b) => a.count - b.count || a.em - b.em || a.waste - b.waste;

function pickType(inventory, links, margin) {
  const keep = (1 - margin);
  const totalW = sum(links.map((l) => l.loadW ?? 0));
  const totalFv = sum(links.map((l) => l.fvV ?? 0));
  const maxW = Math.max(...links.map((l) => l.loadW ?? 0));
  const maxFv = Math.max(...links.map((l) => l.fvV ?? 0));
  let best = null;
  for (const t of sizingCandidates(inventory, links)) {
    const nodeW = Math.min(...t.nodes.map((n) => n.maxLoadW ?? Infinity), t.maxPowerW) * keep;
    const nodeFv = Math.min(...t.nodes.map((n) => n.maxFvV ?? Infinity)) * keep;
    if (maxW > nodeW || maxFv > nodeFv) continue;
    const perDriverW = t.maxPowerW * keep;
    const perDriverFv = nodeFv * t.nodes.length;
    const count = Math.max(1, Math.ceil(totalW / perDriverW),
      Number.isFinite(perDriverFv) ? Math.ceil(totalFv / perDriverFv) : 1);
    const cand = { t, count, waste: count * perDriverW - totalW, em: isEmergency(t.typeRef) ? 1 : 0 };
    if (!best || betterFit(cand, best) < 0) best = cand;
  }
  return best;
}

// Suggest the drivers a zone needs for its unassigned cables, and where each
// cable would go. Sizing is analytic (load + series forward voltage against the
// derated ratings) with a retry: mixed cable sizes can defeat the estimate, so
// if the packer leaves anything over, add a driver and pack again.
export function planDrivers(model, assignments, added, zone, opts = {}) {
  const { restrictControlGroup = true, margin = 0.05 } = opts;
  const ctx = makeCtx(model);
  const a = assignments || {};
  const assigned = new Set(Object.values(a).flatMap((e) => e.refs || []));
  const pool = model.links.filter((l) => l.zone === zone && !assigned.has(l.ref) && !!l.powerType);

  const buckets = new Map();
  for (const l of pool) {
    // fingerprint always splits (a CC cable can't share a CV driver); the
    // ControlGroup split is optional but on by default — check 7 FAILs a node
    // serving two groups, so mixing them would only create work.
    const key = restrictControlGroup ? `${l.controlGroup || '—'} · ${fpKey(l)}` : fpKey(l);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(l);
  }

  const taken = new Set([...model.drivers.map((d) => d.ref), ...(added || []).map((d) => d.ref)]);
  const drivers = [];
  const proposals = [];
  const placements = {};
  const unplaced = [];
  const unmatched = [];

  for (const [key, links] of [...buckets.entries()].sort()) {
    const choice = pickType(ctx.model.inventory, links, margin);
    if (!choice) { unmatched.push({ key, count: links.length }); continue; }
    const refs = links.map((l) => l.ref);
    let count = Math.min(choice.count, refs.length);
    let mine = [];
    let result = { placements: {}, unplaced: refs };
    for (;;) {
      mine = [];
      const trial = new Set([...taken]);
      for (let i = 0; i < count; i += 1) {
        const ref = nextDriverRef(trial);
        trial.add(ref);
        mine.push({ ref, typeRef: choice.t.typeRef, zone });
      }
      const nodeKeys = mine.flatMap((d) => choice.t.nodes.map((n) => `${d.ref}|${n.name}`));
      result = distributeGroup(model, a, [...(added || []), ...drivers, ...mine], refs, nodeKeys, margin);
      if (!result.unplaced.length || count >= refs.length) break;
      count += 1;
    }
    mine.forEach((d) => taken.add(d.ref));
    drivers.push(...mine);
    proposals.push({ key, typeRef: choice.t.typeRef, count: mine.length, cables: refs.length });
    Object.assign(placements, result.placements);
    unplaced.push(...result.unplaced);
  }
  return { drivers, proposals, placements, unplaced, unmatched };
}

// Size a hub from a requirement assessment. Unlike planDrivers, a row here is a
// quantity of fittings rather than a cable, so it divides freely across drivers
// and the count is arithmetic rather than packing.
//
// The arithmetic is the one page 135910 teaches: 55fV per output at 12V a fitting
// is four fittings per output, so a 2-output driver caps at eight whatever its
// wattage says. Which limit bound the count is reported, because that is the
// number a person will argue with.
export function planFromRequirements(model, zone, opts = {}) {
  const {
    restrictControlGroup = true,
    splitByType = true,
    splitByLocation = false,
    preferSingleOutput = true,
    margin = 0.05,
  } = opts;
  const keep = 1 - margin;
  const rows = (model.requirements || []).filter((r) => r.zone === zone && !!r.powerType);

  // Each constraint is a coarser bucket, and a coarser bucket means more
  // drivers. That is the point: an estimate that packs everything as tightly as
  // it will go has quietly made design decisions the detail stage has not taken
  // yet, and it prices for a best case nobody has agreed to.
  const buckets = new Map();
  for (const r of rows) {
    const key = [
      fpKey(r),                                        // a CC fitting cannot share a CV driver
      restrictControlGroup ? (r.controlGroup || '—') : null,
      splitByType ? (r.positionType || '—') : null,
      splitByLocation ? (r.location || '—') : null,
    ].filter((x) => x != null).join(' · ');
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(r);
  }

  const lines = [];
  const unmatched = [];
  for (const [key, group] of [...buckets.entries()].sort()) {
    // What must fit is ONE fitting, not the group total — that is the whole
    // difference between this and packing cables.
    const units = group.map((r) => ({ ...r, loadW: r.wPer, fvV: r.fvPer }));
    const qty = group.reduce((n, r) => n + r.qty, 0);
    const wPer = Math.max(...group.map((r) => r.wPer));
    const fvPer = Math.max(...group.map((r) => r.fvPer ?? 0));
    const totalW = group.reduce((w, r) => w + r.loadW, 0);

    // Rank candidates by the count THIS arithmetic gives, not by pickType's,
    // which ranks on watts. When forward voltage binds — and it usually does —
    // the two disagree: two 35fV fittings on a 55fV node need two outputs, so a
    // 2CH part holds them on one driver while a 1CH part of the same wattage
    // needs two. Ranking on watts picks the 1CH and doubles the estimate.
    let best = null;
    for (const t of sizingCandidates(model.inventory, units)) {
      const node = t.nodes[0] ?? {};
      const perNodeFv = fvPer > 0 && node.maxFvV != null
        ? Math.floor((node.maxFvV * keep) / fvPer) : Infinity;
      const perNodeW = node.maxLoadW != null
        ? Math.floor((node.maxLoadW * keep) / wPer) : Infinity;
      const perNode = Math.min(perNodeFv, perNodeW);
      const perDriverW = Math.floor((t.maxPowerW * keep) / wPer);
      const perDriver = Math.min(perNode * t.nodes.length, perDriverW);
      if (!(perDriver > 0)) continue;

      const count = Math.ceil(qty / perDriver);
      const cand = {
        t,
        count,
        perDriver,
        perNode: Number.isFinite(perNode) ? perNode : null,
        em: isEmergency(t.typeRef) ? 1 : 0,
        waste: count * t.maxPowerW * keep - totalW,
        // the limit that actually bound it, in the reader's terms
        limit: perNode * t.nodes.length <= perDriverW
          ? (perNodeFv <= perNodeW ? 'fV' : 'node W')
          : 'driver W',
      };
      // Fewest drivers is the efficient answer, and a 2-output part usually wins
      // it — two fittings that will not sit in series still sit on one driver,
      // one per output. Early on that is the wrong instinct: it assumes a
      // consolidation the detail design may not follow, so the default is to
      // reach for the simpler single-output part and accept the higher count.
      // Emergency stock is the wrong part, not a less-preferred one, so it
      // outranks the single-output preference: never reach for an EM driver
      // just because it has one output.
      const better = preferSingleOutput
        ? (a, b) => (a.em - b.em) || (a.t.nodes.length - b.t.nodes.length) || betterFit(a, b)
        : betterFit;
      if (!best || better(cand, best) < 0) best = cand;
    }

    if (!best) {
      unmatched.push({ key, qty, rows: group.map((r) => r.ref),
        reason: 'no type in the library can take these' });
      continue;
    }

    lines.push({
      key,
      typeRef: best.t.typeRef,
      name: best.t.name || '',
      count: best.count,
      qty,
      perDriver: best.perDriver,
      perNode: best.perNode,
      limit: best.limit,
      loadW: totalW,
      controlGroup: group[0].controlGroup,
      // what the driver is actually for, and which assessment rows it answers
      positionTypes: [...new Set(group.map((r) => r.positionType).filter(Boolean))],
      locations: [...new Set(group.map((r) => r.location).filter(Boolean))],
      rows: group.map((r) => r.ref),
    });
  }

  const drivers = lines.reduce((n, l) => n + l.count, 0);
  return { zone, lines, unmatched, drivers, loadW: lines.reduce((w, l) => w + l.loadW, 0) };
}

// Every hub in the assessment, sized — or just the one asked for.
export function estimate(model, opts, zone) {
  const zones = zone ? [zone] : [...new Set((model.requirements || []).map((r) => r.zone))].sort();
  return zones.map((z) => planFromRequirements(model, z, opts));
}

// ---- export ----
const quote = (v) => (v == null || v === '' ? '' : `"${String(v).replace(/"/g, '""')}"`);

function derivedControlGroup(ctx, refs) {
  return [...new Set(refs.map((r) => ctx.linksByRef[r]?.controlGroup).filter(Boolean))].sort().join(',');
}

export function exportCsv(model, assignments, added) {
  const ctx = makeCtx(model);
  const a = assignments || {};
  const lines = [model.fieldnames.map(quote).join(',')];

  for (const row of model.originalRows) {
    const key = `${row.ElementRef}|${row.Node}`;
    const entry = a[key];
    const out = { ...row };
    if (entry && !sameRefs(entry.refs, model.baseline[key]?.refs)) {
      const refs = entry.refs || [];
      out.ToEntityRefs = refs.join(',');
      out.ToEntityType = entry.toEntityType || (refs.length ? 'Link' : '');
      out.ControlGroup = derivedControlGroup(ctx, refs);
    }
    lines.push(model.fieldnames.map((c) => quote(out[c])).join(','));
  }

  for (const add of added || []) {
    const t = ctx.inventoryByType[add.typeRef];
    if (!t) continue;
    for (const node of t.nodes) {
      const refs = a[`${add.ref}|${node.name}`]?.refs || [];
      const row = {
        Pullzone: add.zone, ParentElementRef: '', ElementRef: outRef(add.ref), ElementTypeRef: add.typeRef,
        ElementName: '', ElementTypeName: t.name ?? '',
        'Driver Restrictions': t.driverRestrictions, 'Node Restrictions': t.nodeRestrictions,
        CurrentNodePowerInfo: '', Node: node.name, ToEntityType: refs.length ? 'Link' : '',
        ToEntityRefs: refs.join(','), ControlGroup: derivedControlGroup(ctx, refs),
      };
      lines.push(model.fieldnames.map((c) => quote(row[c] ?? '')).join(','));
    }
  }
  return `${lines.join('\r\n')}\r\n`;
}

// Rows (ElementRef+Node) whose link refs differ from the imported baseline, or
// that belong to a driver added in the UI — i.e. exactly what the Review diff
// shows. Shared by the CSV diff view and the patch script below.
export function changedRows(model, assignments, addedDrivers) {
  const a = assignments || {};
  const addedRefs = new Set((addedDrivers || []).map((d) => d.ref));
  const keys = new Set([...Object.keys(model.baseline), ...Object.keys(a)]);
  const rows = [];
  for (const key of keys) {
    const [elementRef, node] = key.split('|');
    const refs = a[key]?.refs || [];
    const was = model.baseline[key]?.refs || [];
    if (!addedRefs.has(elementRef) && sameRefs(refs, was)) continue;
    rows.push({ key, elementRef: outRef(elementRef), node, refs });
  }
  rows.sort((x, y) => x.elementRef.localeCompare(y.elementRef) || x.node.localeCompare(y.node));
  return rows;
}

// ---- patch script (ExcelScript LinksMap merge) ----
// JS port of the DB-Merge macro: for every link ref in a changed assignment
// row, patch LinksMap's FromLinkEndContext* columns to point at the new
// ElementRef+Node. Only rows that actually changed from the imported baseline
// (or belong to a UI-added driver) are patched — same scope as the Review diff.
const esc = (v) => String(v).replace(/"/g, '\\"');

const PATCH_HEADER = `//--DB Merge--//
function main(DB:ExcelScript.Workbook) {
	//Set Columns
		//LinksMap
		let LinksMap=DB.getWorksheet("LinksMap");
		//Find ColumnIndex of core attributes
			let LM_Ref=LinksMap.getCell(0,0).getEntireRow().find("Ref",{completeMatch:true}).getColumnIndex();
			let LM_FromLinkEndContextType=LinksMap.getCell(0,0).getEntireRow().find("FromLinkEndContextType",{completeMatch:true}).getColumnIndex();
			let LM_FromLinkEndContextRef=LinksMap.getCell(0,0).getEntireRow().find("FromLinkEndContextRef",{completeMatch:true}).getColumnIndex();
			let LM_FromLinkEndContextParameters=LinksMap.getCell(0,0).getEntireRow().find("FromLinkEndContextParameters",{completeMatch:true}).getColumnIndex();

	//Patch
`;
const PATCH_FOOTER = '}';

// ---- type presets -> ElementTypes patch ----
// Column names are the DesignDB schema's own (schema_reference > ElementTypes),
// found by header like every other column here, so a reordered sheet still works.
//
// CurrentRange is in AMPS here, the same unit this app holds — a 350mA driver is
// 0.35. schema_reference says milliamps and is wrong: page 135910 states amps
// outright, and its worked example settles it physically (NodeCurrent 6 on an
// output capped at 144W/24V is 6A, not 6mA). No conversion. The mA form appears
// only in the type REF (ET-CCR-D-350-2CH-01), never in a cell.
//
// The node list lives in Parameters as {<OP.1,<OP.2} — one <-prefixed node per
// LED output. That is the channel count, written like any other column.
const TYPE_SHEET = 'ElementTypes';
const TYPE_FIELDS = [
  ['ET_Ref', 'Ref'],
  ['ET_Name', 'Name'],
  ['ET_Parameters', 'Parameters'],
  ['ET_MaxPower', 'MaxPower(W)'],
  ['ET_OutputVoltage', 'OutputVoltage(V)'],
  ['ET_CurrentRange', 'CurrentRange'],
  ['ET_NodeMaxPower', 'NodeMaxPower(W)'],
  ['ET_NodeCurrent', 'NodeCurrent'],
  ['ET_Ballast', 'BallastCountPerUoM'],
  ['ET_ControlType', 'ControlType'],
  ['ET_NodeMaxFv', 'NodeMaxForwardVoltage(fV)'],
  ['ET_IsPropertiesTBC', 'IsPropertiesTBC'],
  ['ET_InternalNotes', 'InternalNotesText'],
];

const typeHeader = () => `\t\t//${TYPE_SHEET}\n`
  + `\t\tlet ${TYPE_SHEET}=DB.getWorksheet("${TYPE_SHEET}");\n`
  + TYPE_FIELDS.map(([v, col]) =>
    `\t\t\tlet ${v}=${TYPE_SHEET}.getCell(0,0).getEntireRow().find("${col}",{completeMatch:true}).getColumnIndex();\n`).join('')
  + '\n';

// One block does patch-or-append: find the Ref, and when it isn't there write a
// new row at the end of the used range instead. Both cases mark the row
// IsPropertiesTBC — a rating typed into this tool is provisional either way.
function typeBlock(t) {
  const ref = esc(t.typeRef);
  const set = (v, val) => `\t\t${TYPE_SHEET}.getCell(r,${v}).setValue(${val})\n`;
  const q = (x) => `"${esc(x)}"`;
  let out = `\t\t//${ref}\n\t\t{\n`
    + `\t\tlet f=${TYPE_SHEET}.getCell(0,ET_Ref).getEntireColumn().find("${ref}",{completeMatch:true});\n`
    + `\t\tlet r=f?f.getRowIndex():${TYPE_SHEET}.getUsedRange().getRowCount();\n`
    + `\t\tif(!f){${TYPE_SHEET}.getCell(r,ET_Ref).setValue("${ref}")}\n`;
  if (t.invented) out += `\t\tif(!f){${TYPE_SHEET}.getCell(r,ET_Name).setValue(${q(t.name || t.typeRef)})}\n`;
  if (t.maxPowerW != null) out += set('ET_MaxPower', g(t.maxPowerW));
  if (t.powerType === 'CV' && t.outputVoltageV != null) out += set('ET_OutputVoltage', g(t.outputVoltageV));
  if (t.powerType === 'CC' && t.currentA != null) out += set('ET_CurrentRange', g(t.currentA));
  out += set('ET_Parameters', q(`{${t.nodes.map((n) => `<${n.name}`).join(',')}}`));
  const node = t.nodes[0] ?? {};
  if (node.maxLoadW != null) out += set('ET_NodeMaxPower', g(node.maxLoadW));
  if (t.nodeCurrentA != null) out += set('ET_NodeCurrent', g(t.nodeCurrentA));
  if (t.ballast != null) out += set('ET_Ballast', g(t.ballast));
  if (t.controlType) out += set('ET_ControlType', q(t.controlType));
  if (node.maxFvV != null) out += set('ET_NodeMaxFv', g(node.maxFvV));
  out += set('ET_IsPropertiesTBC', '"Y"');
  // Only a type that did not exist gets a note: patching an existing row's blanks
  // is a correction, and overwriting someone's notes to say so would lose more
  // than it explains.
  if (t.invented) {
    out += `\t\tif(!f){${TYPE_SHEET}.getCell(r,ET_InternalNotes).setValue(`
      + q('Defined in the Driver Assignment Tool. Ratings supplied by hand, '
        + 'not read from a datasheet - confirm against it before commit.')
      + ')}\n';
  }
  return `${out}\t\t}\n\n`;
}

// Presets worth patching: a correction to a type that really exists, or an
// invented type something actually uses. A preset typed and then abandoned is
// not a change to the workbook.
function patchablePresets(sessions) {
  const out = new Map();
  for (const sn of sessions || []) {
    const known = new Set((sn.model?.inventory ?? []).map((t) => t.typeRef));
    const used = new Set((sn.addedDrivers ?? []).map((d) => d.typeRef));
    for (const p of sn.presets ?? []) {
      const t = presetToType(p);
      if (t.invented ? used.has(t.typeRef) : known.has(t.typeRef)) out.set(t.typeRef, t);
    }
  }
  return [...out.values()].sort((a, b) => a.typeRef.localeCompare(b.typeRef));
}

function patchBlock(ref, elementRef, node) {
  const r = esc(ref);
  return `		//${r}
		LinksMap.getCell(LinksMap.getCell(0,LM_Ref).getEntireColumn().find("${r}",{completeMatch:true}).getRowIndex(),LM_FromLinkEndContextType).setValue("Element")
		LinksMap.getCell(LinksMap.getCell(0,LM_Ref).getEntireColumn().find("${r}",{completeMatch:true}).getRowIndex(),LM_FromLinkEndContextRef).setValue("${esc(elementRef)}")
		LinksMap.getCell(LinksMap.getCell(0,LM_Ref).getEntireColumn().find("${r}",{completeMatch:true}).getRowIndex(),LM_FromLinkEndContextParameters).setValue("{${esc(node)}}")

`;
}

// One script from several saved sessions — the hubs of a branch/set are worked
// one frame at a time, but the workbook is patched once. The body is a flat list
// of per-link blocks, so merging is just concatenation in hub order.
// ---- estimate -> Elements rows ----
// The estimate produces drivers that do not exist yet, so this APPENDS to the
// Elements sheet rather than patching anything. One row per hub + type carrying
// a Quantity, which is why six identical drivers are one row and not six.
//
// Every row carries the same placeholder Ref by design (see PLACEHOLDER_REF).
// Elements.Ref is meant to be unique, so the sheet holds duplicates until a
// human resolves them — the same trade already accepted for added drivers.
const ELEMENT_SHEET = 'Elements';
const ELEMENT_FIELDS = [
  ['EL_Ref', 'Ref'],
  ['EL_Name', 'Name'],
  ['EL_TypeRef', 'TypeRef'],
  ['EL_ContextType', 'ContextType'],
  ['EL_ContextRef', 'ContextRef'],
  ['EL_Quantity', 'Quantity'],
  ['EL_IsPropertiesTBC', 'IsPropertiesTBC'],
];

const elementHeader = () => `\t\t//${ELEMENT_SHEET}\n`
  + `\t\tlet ${ELEMENT_SHEET}=DB.getWorksheet("${ELEMENT_SHEET}");\n`
  + ELEMENT_FIELDS.map(([v, col]) =>
    `\t\t\tlet ${v}=${ELEMENT_SHEET}.getCell(0,0).getEntireRow().find("${col}",{completeMatch:true}).getColumnIndex();\n`).join('')
  // one running row index: each block appends the next row, so the used range is
  // read once rather than re-measured after every write
  + `\t\tlet EL_row=${ELEMENT_SHEET}.getUsedRange().getRowCount();\n\n`;

function elementBlock(zone, line) {
  const q = (x) => `"${esc(x)}"`;
  const set = (v, val) => `\t\t${ELEMENT_SHEET}.getCell(EL_row,${v}).setValue(${val})\n`;
  return `\t\t//${esc(zone)} · ${esc(line.typeRef)} × ${line.count}\n`
    + set('EL_Ref', q(PLACEHOLDER_REF))
    + (line.name ? set('EL_Name', q(line.name)) : '')
    + set('EL_TypeRef', q(line.typeRef))
    + set('EL_ContextType', '"Position"')
    + set('EL_ContextRef', q(zone))
    + set('EL_Quantity', g(line.count))
    + set('EL_IsPropertiesTBC', '"Y"')
    + '\t\tEL_row++\n\n';
}

// The whole estimate as one script. No LinksMap section: at tender stage there
// are no links to repoint.
export function generateEstimatePatch(estimates) {
  const body = (estimates || [])
    .flatMap((z) => z.lines.map((l) => elementBlock(z.zone, l)))
    .join('');
  if (!body) return PATCH_HEADER + PATCH_FOOTER;
  return PATCH_HEADER + elementHeader() + body + PATCH_FOOTER;
}

export function generatePatchScriptMulti(sessions) {
  const body = (sessions || [])
    .flatMap((s) => changedRows(s.model, s.assignments, s.addedDrivers))
    .flatMap((row) => row.refs.map((ref) => patchBlock(ref, row.elementRef, row.node)))
    .join('');
  // The ElementTypes preamble is emitted only when something needs it: those
  // column lookups throw on a workbook that hasn't got them, and a session with
  // no presets must keep producing exactly the script it produced before.
  const presets = patchablePresets(sessions);
  const types = presets.length ? typeHeader() + presets.map(typeBlock).join('') : '';
  return PATCH_HEADER + body + types + PATCH_FOOTER;
}

export function generatePatchScript(model, assignments, addedDrivers, presets) {
  return generatePatchScriptMulti([{ model, assignments, addedDrivers, presets }]);
}
