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
