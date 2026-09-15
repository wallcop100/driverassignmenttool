// The driver tool's answers to core/domain.js.
//
// Every driver-specific reading of a capacity that used to sit inline in
// DriverBin lives here: what the bars mean, which cap actually binds, and what
// the chip beside a ref says. Nothing in core knows a watt from a way.
import { makeDomain } from '../core/domain.js';
import { driverLoad } from '../state.js';
import * as api from '../api.js';

export const drivers = makeDomain({
  id: 'drivers',
  name: 'Driver Assignment Tool',
  msgPrefix: 'dat',
  storagePrefix: 'driverassignmenttool',

  // One bar: watts against MaxPower(W). A type with no MaxPower has no bar to
  // draw and no capacity to check — `cap: null` says so rather than drawing an
  // empty one, and the screen turns it into a sentence.
  capacities: (driver, { assignments, links } = {}) => {
    const load = driverLoad(driver, assignments ?? {}, links ?? {});
    return [{
      label: 'driver total',
      used: load,
      cap: driver.maxPowerW ?? null,
      unit: 'W',
      title: driver.driverRestrictions || 'Driver Restrictions',
    }];
  },

  // Two bars per output, and which watt cap binds is not obvious: a node's own
  // NodeMaxPower(W) if the type states one, otherwise the driver total, which is
  // the real limit and is SHARED across the outputs. Most types state only a
  // forward voltage, so without the fallback an output showed an fV bar and
  // nothing at all for watts.
  slotCapacities: (driver, node, { watts = 0, fv = 0, ghostWatts = null, ghostFv = null } = {}) => {
    const out = [];
    const wCap = node.maxLoadW ?? driver.maxPowerW;
    if (wCap != null) {
      out.push({
        label: null, used: watts, cap: wCap, unit: 'W', projected: ghostWatts,
        title: node.maxLoadW != null
          ? `NodeMaxPower(W) for ${node.name}`
          : `Watts on the driver total, shared across all ${driver.nodes.length} outputs`,
      });
    }
    if (node.maxFvV != null) {
      out.push({ label: null, used: fv, cap: node.maxFvV, unit: 'fV', projected: ghostFv });
    }
    return out;
  },

  // CC 0.35A / CV 24V — the one thing a designer checks first.
  badge: (driver) => ({
    kind: driver.powerType ?? 'unknown',
    text: `${driver.powerType ?? '?'}${
      driver.powerType === 'CC' && driver.currentA ? ` ${driver.currentA}A`
        : driver.powerType === 'CV' && driver.outputVoltageV ? ` ${driver.outputVoltageV}V` : ''}`,
  }),

  // A bigger driver is drawn bigger, because the grid is scanned for headroom.
  widthOf: (driver) => (driver.undetermined
    ? 260
    : Math.max(230, Math.min(140 + driver.maxPowerW * 1.8, 560))),

  groupOf: (link) => link?.controlGroup ?? null,
  groupLabel: 'ControlGroup',

  terms: {
    container: 'driver', containers: 'drivers',
    group: 'zone', groups: 'zones',
    slot: 'output', slots: 'outputs',
  },
  slotSummary: (driver, node, { watts = 0 } = {}) =>
    (driver.undetermined ? 'undetermined' : `${watts.toFixed(1)}W`),
  setupNotice: () => true,
  spaceLayout: true,

  slotsOf: (type) => type?.nodes?.map((n) => n.name) ?? [],

  // A hub the host sends with no cables — only a requirement assessment — is the
  // tender case, and lands on the estimate rather than a tray.
  parseInit: (msg, types) => (msg.assessment && !msg.links?.trim()
    ? api.parseEstimate(msg.assessment, types)
    : api.parseText(msg.form, msg.links, types)),

  validate: (model, assignments, added) => api.validate(assignments, added),
  eligibility: (model, zone, assignments, added) => api.eligibility(zone, assignments, added),
  rebuild: (presets) => api.rebuild(presets),
});

export default drivers;
