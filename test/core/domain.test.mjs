// The contract between the shared screens and a tool's own subject.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NEUTRAL, makeDomain } from '../../src/core/domain.js';
import drivers from '../../src/drivers/domain.js';

test('a half-written domain renders a plain box instead of throwing', () => {
  const half = makeDomain({ id: 'lcp', name: 'LCP Assignment Tool' });
  assert.equal(half.id, 'lcp');
  assert.deepEqual(half.capacities({}), []);
  assert.deepEqual(half.slotCapacities({}, {}), []);
  assert.equal(half.badge({}), null);
  assert.equal(half.widthOf({}), NEUTRAL.widthOf());
});

const D = (o = {}) => ({
  ref: 'E1', typeRef: 'T', maxPowerW: 180, powerType: 'CV', outputVoltageV: 24,
  nodes: [{ name: 'OP.1' }, { name: 'OP.2' }], ...o,
});

test('the driver total is one bar, and no MaxPower means no bar to draw', () => {
  const [bar] = drivers.capacities(D(), { assignments: {}, links: {} });
  assert.equal(bar.label, 'driver total');
  assert.equal(bar.cap, 180);
  assert.equal(bar.unit, 'W');

  const [none] = drivers.capacities(D({ maxPowerW: null }), { assignments: {}, links: {} });
  assert.equal(none.cap, null, 'a null cap is a sentence, not an empty bar');
});

test('an output with no NodeMaxPower falls back to the driver total', () => {
  // most types state only a forward voltage; without the fallback an output
  // showed an fV bar and nothing at all for watts
  const node = { name: 'OP.1', maxFvV: 48 };
  const caps = drivers.slotCapacities(D(), node, { watts: 90, fv: 12 });
  assert.deepEqual(caps.map((c) => c.unit), ['W', 'fV']);
  assert.equal(caps[0].cap, 180, 'the driver total binds');
  assert.match(caps[0].title, /shared across all 2 outputs/);

  // and its own cap wins when the type states one
  const own = drivers.slotCapacities(D(), { name: 'OP.1', maxLoadW: 60 }, {});
  assert.equal(own[0].cap, 60);
  assert.match(own[0].title, /NodeMaxPower\(W\) for OP\.1/);
  assert.equal(own.length, 1, 'no forward-voltage limit, no fV bar');
});

test('the badge says the one thing a designer checks first', () => {
  assert.deepEqual(drivers.badge(D()), { kind: 'CV', text: 'CV 24V' });
  assert.deepEqual(drivers.badge(D({ powerType: 'CC', currentA: 1.05, outputVoltageV: null })),
    { kind: 'CC', text: 'CC 1.05A' });
  assert.deepEqual(drivers.badge(D({ powerType: null })), { kind: 'unknown', text: '?' });
});

test('a bigger driver is drawn bigger, and an undetermined one is not', () => {
  assert.ok(drivers.widthOf(D({ maxPowerW: 360 })) > drivers.widthOf(D({ maxPowerW: 60 })));
  assert.equal(drivers.widthOf(D({ undetermined: true })), 260);
  assert.ok(drivers.widthOf(D({ maxPowerW: 9999 })) <= 560, 'and never off the screen');
});

test('only a subject with a physical space offers the space layout', async () => {
  const { default: lcp } = await import('../../src/lcp/domain.js');
  assert.equal(NEUTRAL.spaceLayout, false, 'off unless a tool says otherwise');
  assert.equal(drivers.spaceLayout, true, 'a PSU hub is a space to lay out');
  assert.equal(lcp.spaceLayout, false, 'a panel\'s arrangement is its ways, already on screen');
});
