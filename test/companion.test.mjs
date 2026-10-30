import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { companionBase, getCompanion, resetCompanion } from '../src/companion.js';

afterEach(() => { resetCompanion(); delete globalThis.fetch; });

test('all three entries find the companion at the site root', () => {
  for (const host of ['https://drivers.erikrees.co.uk/', 'https://wallcop100.github.io/driverassignmenttool/']) {
    for (const entry of ['', 'index.html', 'api/', 'api/index.html?x=1', 'lcp/api/']) {
      assert.equal(companionBase(host + entry), `${host}companion/`, host + entry);
    }
  }
});

const reply = (status, type, body) => async () => ({
  ok: status < 300, status, headers: { get: () => type }, json: async () => body,
});

test('Pages (a 404, or index.html for every path) means no companion', async () => {
  globalThis.fetch = reply(404, 'text/html', null);
  assert.equal(await getCompanion('https://x/'), null);
  resetCompanion();
  globalThis.fetch = reply(200, 'text/html', null);
  assert.equal(await getCompanion('https://x/'), null);
  resetCompanion();
  globalThis.fetch = async () => { throw new Error('offline'); };
  assert.equal(await getCompanion('https://x/'), null);
});

test('a companion speaking the protocol offers report, and posts to companion/reports', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push([url, init?.method]);
    return reply(200, 'application/json', String(url).endsWith('capabilities')
      ? { protocol: 'dat-companion/1', features: ['reports'] } : { received: true, id: 7 })();
  };
  const c = await getCompanion('https://h/api/');
  assert.deepEqual(await c.report({ note: 'x' }), { received: true, id: 7 });
  assert.deepEqual(calls[1], ['https://h/companion/reports', 'POST']);
});

test('a wrong protocol or no reports feature offers nothing', async () => {
  globalThis.fetch = reply(200, 'application/json', { protocol: 'psr-companion/1', features: ['reports'] });
  assert.equal(await getCompanion('https://h/'), null);
  resetCompanion();
  globalThis.fetch = reply(200, 'application/json', { protocol: 'dat-companion/1', features: [] });
  assert.equal((await getCompanion('https://h/')).report, null);
});

test('the parts feature lists and adds, and a refusal comes back as its message', async () => {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push([String(url), init?.method ?? 'GET', init?.body]);
    if (String(url).endsWith('capabilities')) return reply(200, 'application/json', { protocol: 'dat-companion/1', features: ['parts'] })();
    if (init?.method === 'POST' && JSON.parse(init.body).part.name === 'x') return reply(400, 'application/json', { error: 'BAD_PART', message: 'a part needs a name' })();
    return reply(200, 'application/json', { parts: [{ name: 'Acme Drive 100' }] })();
  };
  const c = await getCompanion('https://h/');
  assert.equal(c.report, null);
  assert.deepEqual(await c.parts.list(), { parts: [{ name: 'Acme Drive 100' }] });
  assert.deepEqual((await c.parts.add({ name: 'Acme Drive 100' })).parts.length, 1);
  assert.deepEqual(calls[2].slice(0, 2), ['https://h/companion/parts', 'POST']);
  assert.deepEqual(await c.parts.add({ name: 'x' }), { error: 'a part needs a name' });
  resetCompanion();
  globalThis.fetch = reply(200, 'application/json', { protocol: 'dat-companion/1', features: ['reports'] });
  assert.equal((await getCompanion('https://h/')).parts, null, 'Pages and old bridges have no parts');
});
