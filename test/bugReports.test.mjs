import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newId, reportsToMarkdown } from '../src/bugReports.js';

test('ids are 6 unambiguous characters and unique among saved ones', () => {
  const taken = new Set();
  for (let i = 0; i < 200; i += 1) {
    const id = newId(taken);
    assert.match(id, /^[A-HJ-NP-Z2-9]{6}$/);
    assert.ok(!taken.has(id));
    taken.add(id);
  }
});

test('markdown lists oldest first, heads with the id, and leaves empty fields out', () => {
  const md = reportsToMarkdown([
    { id: 'BBBBBB', at: '2026-10-02T12:00:00.000Z', note: 'later\nmore', kind: 'feature', version: 'dev' },
    { id: 'AAAAAA', at: '2026-10-01T09:00:00.000Z', note: 'first', version: 'dev',
      app: { screen: 'estimate', zone: 'HUB-A', counts: { drivers: 3 } }, viewport: '1×2' },
  ]);
  assert.ok(md.startsWith('# Bug reports (2)'));
  assert.ok(md.indexOf('## AAAAAA · first') < md.indexOf('## BBBBBB · Feature request · later'));
  assert.match(md, /\*\*Hub:\*\* HUB-A \/ \*\*Screen:\*\* estimate/);
  assert.match(md, /\*\*Counts:\*\* drivers 3/);
  assert.ok(!/Clicked/.test(md));
});

// --- what a SENT report carries (SELFHOST_PLAN §3) ---
import { flaggedRow, remoteReport } from '../src/bugReports.js';

const model = {
  drivers: [{ ref: 'E-100', name: 'DRV 1', typeRef: 'ET-7', typeName: 'SoloDrive 360/A', zone: 'Z1',
    powerType: 'CC', maxPowerW: 60, currentA: 0.35, nodes: [{ name: 'OUT1', maxLoadW: 30 }, { name: 'OUT2', maxLoadW: 30 }],
    driverRestrictions: 'secret-ish text' }],
  links: [
    { ref: 'L-1', typeRef: 'LT-1', zone: 'Z1', loadW: 12.5, currentA: 0.35, powerType: 'CC', controlGroup: 'CG-A',
      location: 'Bedroom 3, Smith residence' },
    { ref: 'L-2', zone: 'Z1', loadW: 8, location: 'Kitchen' },
  ],
  baseline: { 'E-100|OUT1': { refs: ['L-1'] }, 'E-100|OUT2': { refs: [] } },
};
const assignments = { 'E-100|OUT1': { refs: [] }, 'E-100|OUT2': { refs: ['L-1', 'L-2'] } };
const flags = [{ driver: 'E-100', node: 'OUT2', link: 'L-1', level: 'FAIL', check: 'capacity', message: 'over' }];
const local = {
  id: 'ABCDEF', at: '2026-10-27T10:00:00.000Z', note: 'wrong fit', version: '0.1.0',
  app: { screen: 'zone', zone: 'Z1', counts: { drivers: 1 } },
  dom: { element: 'td “Bedroom 3”', areas: ['tray'], dialogs: [], row: 'L-1 | Bedroom 3, Smith residence | 12.5 W', refs: ['L-1'], code: '' },
  trail: [{ at: '2026-10-27T09:59:00.000Z', screen: 'zone', label: 'button “Bedroom 3”' }],
  viewport: '1×2',
};

test('a flagged link carries its ids, type, loadings and proposed vs baseline placement', () => {
  const row = flaggedRow(['L-1'], { model, assignments, flags });
  assert.equal(row.kind, 'link');
  assert.equal(row.loadW, 12.5);
  assert.equal(row.typeRef, 'LT-1');
  assert.deepEqual(row.proposed, [{ driver: 'E-100', node: 'OUT2' }]);
  assert.deepEqual(row.baseline, [{ driver: 'E-100', node: 'OUT1' }]);
  assert.equal(row.flags[0].check, 'capacity');
  assert.equal(row.location, undefined);
});

test('a flagged driver carries its part, ratings, nodes and the links proposed on it', () => {
  const row = flaggedRow(['nope', 'E-100'], { model, assignments, flags });
  assert.equal(row.kind, 'driver');
  assert.equal(row.typeName, 'SoloDrive 360/A');
  assert.deepEqual(row.nodes[1].proposed, ['L-1', 'L-2']);
  assert.deepEqual(row.links.map((l) => l.ref), ['L-1', 'L-2']);
  assert.equal(row.driverRestrictions, undefined);
});

test('no ref that resolves is no row, not an error', () => {
  assert.equal(flaggedRow(['X'], { model }), null);
  assert.equal(flaggedRow(['L-1'], {}), null);
});

test('a sent report never carries on-screen free text, CSV contents or extra context', () => {
  const r = remoteReport(local, { model, assignments, flags, mode: 'embed',
    context: { systemSetId: 109833, hubRef: 'P-1', hubLabel: 'HUB A', secret: 'x' } });
  const text = JSON.stringify(r);
  for (const leak of ['Bedroom', 'Smith', 'Kitchen', 'secret', 'element']) assert.ok(!text.includes(leak), leak);
  assert.deepEqual(r.context, { systemSetId: 109833, hubRef: 'P-1', hubLabel: 'HUB A' });
  assert.deepEqual(r.trail, [{ at: '2026-10-27T09:59:00.000Z', screen: 'zone' }]);
  assert.equal(r.id, 'ABCDEF');
  assert.equal(r.kind, 'bug');
  assert.equal(r.row.ref, 'L-1');
});

test('a big hub still sends a small report', () => {
  const links = Array.from({ length: 500 }, (_, i) => ({ ref: `L-${i}`, loadW: 5, controlGroup: 'CG' }));
  const big = { ...model, links };
  const r = remoteReport({ ...local, dom: { ...local.dom, refs: ['E-100'] } },
    { model: big, assignments: { 'E-100|OUT1': { refs: links.map((l) => l.ref) } } });
  assert.equal(r.row.links.length, 24);
  assert.ok(JSON.stringify(r).length < 16_000);
});
