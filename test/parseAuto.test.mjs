// The standalone drop: which file combinations open, and which ask for driver types.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import * as api from '../src/api.js';

const demo = (n) => fs.readFileSync(new URL(`../src/demo/${n}.csv`, import.meta.url), 'utf-8');
const file = (name, text) => ({ name, text: async () => text });

test('links + driver assignment open without a type library', async () => {
  const model = await api.parseAuto([file('l.csv', demo('links')), file('f.csv', demo('form'))]);
  assert.ok(model.links.length > 0);
});

test('an assessment alone asks for driver types, it does not dead-end', async () => {
  await assert.rejects(api.parseAuto([file('a.csv', demo('assessment'))]), { code: 'needs-types' });
});
