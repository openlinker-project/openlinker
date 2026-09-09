#!/usr/bin/env node
'use strict';

/**
 * Tests for the eparagony.pl stub (#3043, F14).
 *
 * Runs with `node test.mjs` (node:test + node:assert are node core), mirroring
 * stubs/invoicing/test.mjs. The server module is imported directly and
 * started on an ephemeral port.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { server, _resetForTest } = await import('./server.mjs');

let baseUrl;

test.before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(() => {
  server.close();
});

test.beforeEach(() => {
  _resetForTest();
});

async function call(method, path, body, headers) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  return { status: res.status, json };
}

test('POST /auth/token answers 200 with an access_token', async () => {
  const { status, json } = await call('POST', '/auth/token', undefined);
  assert.equal(status, 200);
  assert.ok(typeof json.access_token === 'string' && json.access_token.length > 0);
});

test('POST /documents without Idempotency-Key answers 400', async () => {
  const { status, json } = await call('POST', '/documents', { eReceipt: {} });
  assert.equal(status, 400);
  assert.equal(json.errorCode, 998);
});

test('POST /documents then GET status confirms after pollsUntilOutcome reads', async () => {
  await call('PUT', '/__stub/config', { pollsUntilOutcome: 1 });
  const create = await call('POST', '/documents', { eReceipt: {} }, { 'Idempotency-Key': 'tok-1' });
  assert.equal(create.status, 202);

  const poll1 = await call('GET', '/documents/tok-1/status');
  assert.equal(poll1.json.status, 'READY');

  const poll2 = await call('GET', '/documents/tok-1/status');
  assert.equal(poll2.json.status, 'CONFIRMED');
  assert.ok(typeof poll2.json.fiscalDocumentId === 'string');
});

test('repeat create under the same token answers errorCode 118 (already exists) - VALID replay', async () => {
  await call('POST', '/documents', { eReceipt: {} }, { 'Idempotency-Key': 'tok-2' });
  const repeat = await call('POST', '/documents', { eReceipt: {} }, { 'Idempotency-Key': 'tok-2' });
  assert.equal(repeat.status, 409);
  assert.equal(repeat.json.errorCode, 118);
});

test('forceOutcome=error reports ERROR after the configured poll count - DISCARDED path', async () => {
  await call('PUT', '/__stub/config', { forceOutcome: 'error', pollsUntilOutcome: 0 });
  await call('POST', '/documents', { eReceipt: {} }, { 'Idempotency-Key': 'tok-3' });
  const poll = await call('GET', '/documents/tok-3/status');
  assert.equal(poll.json.status, 'ERROR');
});

test('forceOutcome=hang never reaches a terminal status - the in-doubt shape', async () => {
  await call('PUT', '/__stub/config', { forceOutcome: 'hang' });
  await call('POST', '/documents', { eReceipt: {} }, { 'Idempotency-Key': 'tok-4' });
  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop -- sequential polls, intentional
    const poll = await call('GET', '/documents/tok-4/status');
    assert.equal(poll.json.status, 'READY');
  }
});

test('GET status for an unknown token answers errorCode 92', async () => {
  const { status, json } = await call('GET', '/documents/never-created/status');
  assert.equal(status, 404);
  assert.equal(json.errorCode, 92);
});

test('GET /printers/:id/status answers online', async () => {
  const { status, json } = await call('GET', '/printers/STUB0000000001/status');
  assert.equal(status, 200);
  assert.equal(json.status, 'online');
});

test('POST /documents honours the configured latency (measured, not asserted blind)', async () => {
  await call('PUT', '/__stub/config', { latencyMs: 50 });
  const start = Date.now();
  await call('POST', '/documents', { eReceipt: {} }, { 'Idempotency-Key': 'tok-5' });
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 40, `expected >= 40ms elapsed, got ${elapsed}ms`);
});
