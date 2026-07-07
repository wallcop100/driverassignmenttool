// Client-side port of the former Python sidecar (parsing + DriverHealthCheck
// validation + export). Pure functions — the renderer owns all state. Runs in
// the browser and under node (see test/engine.test.mjs).
import Papa from 'papaparse';

const CURRENT_TOLERANCE = 0.15;

const DRIVER_RE = /(?<Watts>\d+(\.\d+)?)W(\s\|\s(?<Value>\d+(\.\d+)?)(?<Unit>[AV]))?/;
const NODE_FV_RE = /(?<FV>\d+(\.\d+)?)fV/;
const NODE_W_RE = /(?<W>\d+(\.\d+)?)W/;

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

function readCsv(text, required, label) {
  const { data, meta, errors } = Papa.parse(text, { header: true, skipEmptyLines: 'greedy' });
  if (!data.length) throw new Error(`${label}: file is empty or has no data rows`);
  const missing = required.filter((c) => !meta.fields.includes(c));
  if (missing.length) throw new Error(`${label}: missing column(s): ${missing.join(', ')}`);
  if (errors.length) throw new Error(`${label}: ${errors[0].message} (row ${errors[0].row})`);
  return { rows: data, fields: meta.fields };
}

// Autodetect which CSV a dropped file is, by its header signature.
export function detectKind(text) {
  const { meta } = Papa.parse(text, { header: true, preview: 1 });
  const f = meta.fields || [];
  if (f.includes('LinkRef')) return 'links';
  if (f.includes('ElementRef') && f.includes('Node')) return 'form';
  return null;
}

// ---- parsing ----
export function parseDriverRestrictions(raw) {
  const m = DRIVER_RE.exec(raw || '');
  if (!m) return { powerType: null, maxPowerW: null, currentA: null, outputVoltageV: null };
  const watts = Number(m.groups.Watts);
  const { Unit, Value } = m.groups;
  if (Unit === 'A') return { powerType: 'CC', maxPowerW: watts, currentA: Number(Value), outputVoltageV: null };
  if (Unit === 'V') return { powerType: 'CV', maxPowerW: watts, currentA: null, outputVoltageV: Number(Value) };
  return { powerType: null, maxPowerW: watts, currentA: null, outputVoltageV: null };
}

export function parseNodeRestrictions(raw) {
  const w = NODE_W_RE.exec(raw || '');
  const fv = NODE_FV_RE.exec(raw || '');
  return { maxLoadW: w ? Number(w.groups.W) : null, maxFvV: fv ? Number(fv.groups.FV) : null };
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

function parseLinks(text) {
  const { rows } = readCsv(text, LINK_ESSENTIAL, 'Links Assignment CSV');
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

function buildInventory(drivers) {
  const inv = new Map();
  for (const d of drivers) {
    const cur = inv.get(d.typeRef);
    if (!cur || d.nodes.length > cur.nodes.length) {
      inv.set(d.typeRef, {
        typeRef: d.typeRef, powerType: d.powerType, maxPowerW: d.maxPowerW,
        currentA: d.currentA, outputVoltageV: d.outputVoltageV, undetermined: d.undetermined,
        driverRestrictions: d.driverRestrictions, nodeRestrictions: d.nodeRestrictions, nodes: d.nodes,
      });
    }
  }
  return inv;
}

export function buildModel(formText, linksText) {
  const { drivers, baseline, originalRows, fieldnames } = parseForm(formText);
  const links = parseLinks(linksText);
  const zones = [...new Set([...drivers.map((d) => d.zone), ...links.map((l) => l.zone)])].sort();
  const inventory = buildInventory(drivers);
  return {
    zones, drivers, links, baseline, originalRows, fieldnames,
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

  // 6. Current match (CC, 15% band)
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

export function suggest(model, linkRef, assignments, added) {
  const ctx = makeCtx(model);
  ctx._drivers = effectiveDrivers(ctx, added);
  return suggestCtx(ctx, linkRef, assignments || {});
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
export function distributeGroup(model, assignments, added, linkRefs, nodeKeys) {
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
    capW[key] = node.maxLoadW ?? Infinity;
    capFv[key] = node.maxFvV ?? Infinity;
    if (drvCap[dref] === undefined) {
      drvCap[dref] = driver.maxPowerW ?? Infinity;
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
    if (entry && (entry.refs || []).join() !== (model.baseline[key]?.refs || []).join()) {
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
        Pullzone: add.zone, ParentElementRef: '', ElementRef: add.ref, ElementTypeRef: add.typeRef,
        'Driver Restrictions': t.driverRestrictions, 'Node Restrictions': t.nodeRestrictions,
        CurrentNodePowerInfo: '', Node: node.name, ToEntityType: refs.length ? 'Link' : '',
        ToEntityRefs: refs.join(','), ControlGroup: derivedControlGroup(ctx, refs),
      };
      lines.push(model.fieldnames.map((c) => quote(row[c] ?? '')).join(','));
    }
  }
  return `${lines.join('\r\n')}\r\n`;
}
