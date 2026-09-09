#!/usr/bin/env node
'use strict';

/**
 * Tests for the carrier stub (#3043, F15).
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

test('POST /labels with default config mints tracking synchronously - VALID happy path', async () => {
  const { status, json } = await call('POST', '/labels', { shipmentId: 'ol_shipment_1' });
  assert.equal(status, 201);
  assert.ok(typeof json.providerShipmentId === 'string');
  assert.ok(typeof json.trackingNumber === 'string');
});

test('mintTrackingImmediately=false leaves tracking null until pollsUntilTracking reads', async () => {
  await call('PUT', '/__stub/config', { mintTrackingImmediately: false, pollsUntilTracking: 2 });
  const { json: label } = await call('POST', '/labels', { shipmentId: 'ol_shipment_2' });
  assert.equal(label.trackingNumber, null);

  const poll1 = await call('GET', `/shipments/${label.providerShipmentId}/tracking`);
  assert.equal(poll1.json.trackingNumber, null);
  assert.equal(poll1.json.status, 'generated');

  const poll2 = await call('GET', `/shipments/${label.providerShipmentId}/tracking`);
  assert.ok(typeof poll2.json.trackingNumber === 'string');
  assert.equal(poll2.json.status, 'dispatched');
});

test('GET tracking for an unknown providerShipmentId answers 404 - DISCARDED', async () => {
  const { status } = await call('GET', '/shipments/never-created/tracking');
  assert.equal(status, 404);
});

test('POST /labels honours the configured latency (measured, not asserted blind)', async () => {
  await call('PUT', '/__stub/config', { latencyMs: 50 });
  const start = Date.now();
  await call('POST', '/labels', { shipmentId: 'ol_shipment_3' });
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 40, `expected >= 40ms elapsed, got ${elapsed}ms`);
});
