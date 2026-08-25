import assert from 'node:assert/strict';
import test from 'node:test';
import { VERSION, validateInit, validateTypes } from '../src/embed.js';

const HOST = 'https://example.com';
const good = { type: 'dat:init', version: VERSION, form: 'Pullzone,ElementRef\n', links: 'LinkRef\n' };

test('accepts a well-formed init from the allowed origin', () => {
  assert.equal(validateInit(good, HOST, HOST).ok, true);
});

// Everything below must be DROPPED — returned as { ok: false }, never thrown.
// A throw here would surface as an unhandled rejection in the message handler
// and leave the iframe blank, which is the failure mode we are avoiding.
for (const [name, msg, origin, allowed] of [
  ['wrong origin', good, 'https://evil.example', HOST],
  ['no allowed origin (missing/unlisted parentOrigin)', good, HOST, ''],
  ['unknown version', { ...good, version: 99 }, HOST, HOST],
  ['missing version', { ...good, version: undefined }, HOST, HOST],
  ['wrong type', { ...good, type: 'other:thing' }, HOST, HOST],
  ['non-string form', { ...good, form: 42 }, HOST, HOST],
  ['missing links', { ...good, links: undefined }, HOST, HOST],
  ['non-string links', { ...good, links: 42 }, HOST, HOST],
  ['null message', null, HOST, HOST],
  ['string message', 'dat:init', HOST, HOST],
  ['array message', [], HOST, HOST],
]) {
  test(`drops: ${name}`, () => {
    const r = validateInit(msg, origin, allowed);
    assert.equal(r.ok, false);
    assert.equal(typeof r.reason, 'string');
  });
}

// A hub with no drivers yet has no Driver Assignment rows to send — links alone
// is a legitimate payload (the tool sizes the drivers from the type library).
test('accepts an init with no form CSV — the greenfield hub', () => {
  assert.deepEqual(validateInit({ ...good, form: undefined }, HOST, HOST), { ok: true });
  // what the overlay actually sends: an empty <script> block, not a missing key
  assert.deepEqual(validateInit({ ...good, form: '' }, HOST, HOST), { ok: true });
});

test('a version mismatch is flagged for an explicit UI state, not silently ignored', () => {
  const r = validateInit({ ...good, version: 99 }, HOST, HOST);
  assert.equal(r.mismatch, true);
  assert.match(r.reason, /99/);
});

test('an origin mismatch is not flagged — dropped silently, payload never echoed', () => {
  const r = validateInit(good, 'https://evil.example', HOST);
  assert.equal(r.mismatch, undefined);
  assert.equal(r.reason.includes('form'), false);
});

// ---- dat:types ----

const goodTypes = { type: 'dat:types', version: VERSION, types: 'ElementTypeRef\nET-X\n' };

test('accepts a well-formed types message', () => {
  assert.equal(validateTypes(goodTypes, HOST, HOST).ok, true);
});

test('init and types do not accept each other', () => {
  assert.equal(validateTypes(good, HOST, HOST).ok, false);
  assert.equal(validateInit(goodTypes, HOST, HOST).ok, false);
});

for (const [name, msg, origin, allowed] of [
  ['wrong origin', goodTypes, 'https://evil.example', HOST],
  ['no allowed origin', goodTypes, HOST, ''],
  ['unknown version', { ...goodTypes, version: 99 }, HOST, HOST],
  ['missing types', { ...goodTypes, types: undefined }, HOST, HOST],
  ['blank types', { ...goodTypes, types: '  ' }, HOST, HOST],
  ['null message', null, HOST, HOST],
]) {
  test(`drops types: ${name}`, () => {
    const r = validateTypes(msg, origin, allowed);
    assert.equal(r.ok, false);
    assert.equal(typeof r.reason, 'string');
  });
}
