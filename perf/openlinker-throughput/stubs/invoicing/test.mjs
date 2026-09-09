#!/usr/bin/env node
'use strict';

/**
 * Tests for the invoicing-provider stub (#3006).
 *
 * Runs with `node test.mjs` (node:test + node:assert are node core), mirroring
 * stubs/allegro/test.mjs. The server module is imported directly and started
 * on an ephemeral port so tests never depend on STUB_PORT / a real container.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const { server, describeConfig, _resetForTest } = await import('./server.mjs');

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

async function call(method, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : undefined;
  return { status: res.status, json };
}

test('POST /invoices answers 201 with status: issued', async () => {
  const { status, json } = await call('POST', '/invoices', { orderId: 'x' });
  assert.equal(status, 201);
  assert.equal(json.status, 'issued');
  assert.ok(typeof json.id === 'string' && json.id.length > 0);
});

test('POST /invoices honours the configured latency (measured, not asserted blind)', async () => {
  await call('PUT', '/__stub/config', { latencyMs: 50 });
  const start = Date.now();
  await call('POST', '/invoices', {});
  const elapsed = Date.now() - start;
  // A generous floor: this is timing-sensitive CI, not a precision claim.
  // The point is "did the sleep happen at all", not "exactly 50ms".
  assert.ok(elapsed >= 40, `expected >= 40ms elapsed, got ${elapsed}ms`);
});

test('GET /__stub/config reports latency, requestsTotal and issuedCount', async () => {
  await call('PUT', '/__stub/config', { latencyMs: 5 });
  await call('POST', '/invoices', {});
  await call('POST', '/invoices', {});
  const { json } = await call('GET', '/__stub/config');
  assert.equal(json.latencyMs, 5);
  assert.equal(json.requestsTotal, 2);
  assert.equal(json.issuedCount, 2);
  assert.equal(json.inFlight, 0);
});

test('maxInFlightObserved tracks CONCURRENT requests, not sequential ones (the property the whole scenario reads)', async () => {
  await call('PUT', '/__stub/config', { latencyMs: 100 });
  // Fire 4 requests concurrently; each blocks for 100ms, so all 4 must
  // overlap if this assertion is to distinguish real concurrency from a
  // server that serializes requests it received in parallel.
  await Promise.all([
    call('POST', '/invoices', {}),
    call('POST', '/invoices', {}),
    call('POST', '/invoices', {}),
    call('POST', '/invoices', {}),
  ]);
  const { json } = await call('GET', '/__stub/config');
  assert.equal(json.maxInFlightObserved, 4);
});

test('sequential requests (no overlap) report maxInFlightObserved of 1 - the guard\'s DISCARDED case', async () => {
  await call('PUT', '/__stub/config', { latencyMs: 5 });
  await call('POST', '/invoices', {});
  await call('POST', '/invoices', {});
  await call('POST', '/invoices', {});
  const { json } = await call('GET', '/__stub/config');
  // This is the negative case for the concurrency assertion above: run the
  // SAME calls sequentially (awaited one at a time) and confirm the counter
  // reports 1, not 4 - proving the metric is measuring real overlap and not
  // just "how many calls were made this window".
  assert.equal(json.maxInFlightObserved, 1);
});

test('POST /__stub/reset zeroes requestsTotal/issuedCount but leaves latencyMs untouched', async () => {
  await call('PUT', '/__stub/config', { latencyMs: 33 });
  await call('POST', '/invoices', {});
  const { json: reset } = await call('POST', '/__stub/reset', {});
  assert.equal(reset.requestsTotal, 0);
  assert.equal(reset.issuedCount, 0);
  assert.equal(reset.latencyMs, 33, 'latency is the arm\'s independent variable and must survive a reset');
});

test('GET /__stub/health answers ok', async () => {
  const { status, json } = await call('GET', '/__stub/health');
  assert.equal(status, 200);
  assert.equal(json.ok, true);
});

test('an unknown path answers 404', async () => {
  const { status } = await call('GET', '/definitely-not-a-real-endpoint');
  assert.equal(status, 404);
});

test('a malformed PUT /__stub/config body answers 400 rather than crashing the server', async () => {
  const { status } = await call('PUT', '/__stub/config', undefined);
  // Sending no body at all is valid (empty object) - assert the shape holds
  // for a genuinely malformed one instead.
  const res = await fetch(`${baseUrl}/__stub/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: 'not json',
  });
  assert.equal(res.status, 400);
  assert.equal(status, 200);
});

// Sanity check on the export used by the tests above and by the reset test:
// describeConfig() must be a pure read with no side effects of its own.
test('describeConfig is side-effect-free', () => {
  const a = describeConfig();
  const b = describeConfig();
  assert.deepEqual(a, b);
});
