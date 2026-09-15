// What a tool has to tell the shared components about its own subject.
//
// The core screens — a container with slots, a tray of things to place, a review
// of what changed — are the same whether the container is a PSU hub full of
// drivers or a control panel full of modules. What differs is what a capacity
// MEANS: watts and forward volts on a driver output, ways and terminals on a
// panel module. So the components ask the domain rather than reading
// `maxPowerW` themselves.
//
// Every field has a neutral default, so a tool supplies only what it has and a
// half-written domain renders a plain box instead of throwing.
import { createContext, useContext } from 'react';

export const NEUTRAL = {
  id: 'core',
  name: 'Assignment Tool',
  msgPrefix: 'dat',
  storagePrefix: 'assignmenttool',

  // [{ label, used, cap, unit, title, fail }] — the bars across a container.
  // `null` cap means "no declared limit", which is a fact worth drawing, not a
  // zero-width bar.
  capacities: () => [],

  // the same, for one slot of a container
  slotCapacities: () => [],

  // the chip beside a container's ref: { text, kind } or null
  badge: () => null,

  // how wide to draw a container, in px. Sized by capacity where a domain has
  // one, so a big driver looks big.
  widthOf: () => 260,

  // The words the user sees. The model calls everything a driver and a node
  // because renaming the shape would fork every shared screen; this is where the
  // screens get the right nouns back.
  terms: {
    container: 'driver', containers: 'drivers',
    group: 'zone', groups: 'zones',
    slot: 'output', slots: 'outputs',
  },

  // What a cable is grouped BY on screen — the chip on a slot, the colour, and
  // the tray's grouping. A driver cares about the ControlGroup; a panel does not:
  // there, what matters is the loop, Link_ControlDetails, because that is what a
  // circuit or a bus segment is.
  groupOf: (link) => link?.controlGroup ?? null,
  groupLabel: 'ControlGroup',

  // May one slot legitimately carry several groups? On a driver output, no — it
  // is one circuit. On a panel's bus terminal, yes, and painting it as a fault
  // is the tool being wrong rather than the design.
  slotAllowsManyGroups: () => false,

  // The headline figure beside a container's ref in a slot: watts on a driver
  // output, nothing at all where a count is already the bar.
  slotSummary: () => null,

  // Whether this tool has an onboarding notice to show at all.
  setupNotice: () => false,

  // Whether this subject has a physical space to lay out. A PSU hub does - that
  // is the space requirement drawing. A control panel's arrangement is its ways,
  // which the panel view already is.
  spaceLayout: false,

  // 'grid' wraps containers into a flowing grid; 'column' stacks them in one
  // column, in order, the way equipment sits on a rail.
  binLayout: 'grid',

  // what a container's slots are called, from its type
  slotsOf: (type) => type?.nodes?.map((n) => n.name) ?? [],

  // Turn what the host sent into a model. Each tool is sent different payloads
  // by its own overlay, so each reads its own; `null` means "I have no parser",
  // which the screen reports rather than crashing on.
  parseInit: () => null,

  // What is wrong with the current assignments, and what may go where. Both are
  // async because the driver tool's are, and both have a do-nothing default so a
  // tool without rules yet simply reports none.
  validate: async () => ({ flags: [] }),
  eligibility: async () => null,

  // Rebuild the model after a type edit. Only a tool that keeps its source text
  // can do this; the rest say "nothing changed".
  rebuild: () => null,
};

export const makeDomain = (partial = {}) => ({ ...NEUTRAL, ...partial });

const DomainContext = createContext(NEUTRAL);
export const DomainProvider = DomainContext.Provider;
export const useDomain = () => useContext(DomainContext);
