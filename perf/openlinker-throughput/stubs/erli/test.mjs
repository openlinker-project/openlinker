#!/usr/bin/env node
'use strict';

/**
 * Tests for the Erli Shop API stub (#3043).
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

test('GET /me answers 200 - connection-tester probe', async () => {
  const { status, json } = await call('GET', '/me');
  assert.equal(status, 200);
  assert.ok(json.id);
});

test('GET /inbox starts empty', async () => {
  const { status, json } = await call('GET', '/inbox');
  assert.equal(status, 200);
  assert.deepEqual(json, []);
});

test('seeding an order surfaces it in the inbox and via GET /orders/:id', async () => {
  const seed = await call('POST', '/__stub/seed-order', { id: 'ord-1', status: 'NEW' });
  assert.equal(seed.status, 201);

  const inbox = await call('GET', '/inbox');
  assert.equal(inbox.json.length, 1);
  assert.equal(inbox.json[0].type, 'orderCreated');
  assert.equal(inbox.json[0].payload.id, 'ord-1');

  const order = await call('GET', '/orders/ord-1');
  assert.equal(order.status, 200);
  assert.equal(order.json.id, 'ord-1');
});

test('PATCH /products/:id (quantity write) answers 200 and is counted', async () => {
  const { status } = await call('PATCH', '/products/ol_variant_x', { stock: 5 });
  assert.equal(status, 200);
  const config = await call('GET', '/__stub/config');
  assert.equal(config.json.quantityWritesTotal, 1);
});

test('an unseeded order id still resolves (synthetic fallback), never a 404', async () => {
  const { status, json } = await call('GET', '/orders/never-seeded');
  assert.equal(status, 200);
  assert.equal(json.id, 'never-seeded');
});

test('an unmodelled path answers 404 - DISCARDED, not silently accepted', async () => {
  const { status } = await call('GET', '/something-not-served');
  assert.equal(status, 404);
});
