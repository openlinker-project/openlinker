#!/usr/bin/env node
'use strict';

/**
 * Tests for the Allegro upstream stub (#2856).
 *
 * Runs with `node test.mjs` - node:test and node:assert are both node core,
 * so no test runner needs to be installed. This file is outside the pnpm
 * workspace (perf/ is not a workspace member, see server.mjs's header), so
 * Jest is not reachable here without editing pnpm-workspace.yaml, which
 * #2856's own Build Specification says to avoid.
 *
 * The server module is imported directly (not shelled out to) so tests run
 * on an ephemeral port and can reach into `state`/`CONFIG` when a black-box
 * HTTP assertion alone would not be enough (e.g. confirming a cursor's
 * internal shape is truly unrecognised by the real regression guard).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

// Keep the per-request latency small in this suite so ~40 assertions run in
// well under a second - production runs set a realistic value via
// STUB_PER_REQUEST_LATENCY_MS on the container. Must be set BEFORE the
// dynamic import below, since CONFIG is captured once at module load.
process.env.STUB_PER_REQUEST_LATENCY_MS ??= '5';
const { server, CONFIG } = await import('./server.mjs');

let baseUrl;

test.before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(() => {
  server.close();
});

const TOKEN_A = 'stub-token-a';
const TENANT_A = 'perf-allegro-a';
const TOKEN_B = 'stub-token-b';
const TENANT_B = 'perf-allegro-b';

async function call(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token !== null) headers.Authorization = `Bearer ${token ?? TOKEN_A}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, headers: res.headers, body: json, raw: text };
}

/** Resets every tenant's state to a fresh, disjoint run id. */
async function resetRun(runId) {
  const { body } = await call('POST', '/__stub/run', { token: null, body: runId ? { runId } : {} });
  return body.runId;
}

// ---------------------------------------------------------------------------
// Never 401 - Problem/Context: a 401 escapes to the hardcoded real
// allegro.pl OAuth host and can flag the connection needs_reauth.
// ---------------------------------------------------------------------------

test('never answers 401, for any path, any token, any fault mode', async () => {
  await resetRun('t-401');
  await call('POST', `/__stub/tenants/${TENANT_A}/fault`, {
    token: null,
    body: { mode: '429' },
  });

  const attempts = [
    ['GET', '/order/events', TOKEN_A],
    ['GET', '/order/events', 'not-a-real-token'],
    ['GET', '/order/events', null], // no Authorization header at all
    ['GET', '/order/checkout-forms/does-not-exist', TOKEN_A],
    ['GET', '/me', 'garbage'],
    ['GET', '/some/unknown/path', TOKEN_A],
  ];

  for (const [method, path, token] of attempts) {
    const { status } = await call(method, path, { token });
    assert.notEqual(status, 401, `${method} ${path} with token=${token} must never be 401`);
  }

  await call('DELETE', `/__stub/tenants/${TENANT_A}/fault`, { token: null });
});

// ---------------------------------------------------------------------------
// Unknown cursor tolerated, never 404
// ---------------------------------------------------------------------------

test('an unknown `from` cursor is tolerated, not 404d', async () => {
  await resetRun('t-unknown-cursor');
  const { status, body } = await call(
    'GET',
    '/order/events?from=some-cursor-from-a-different-run&limit=10',
    { token: TOKEN_A }
  );
  assert.equal(status, 200);
  assert.deepEqual(body.events, []);
});

// ---------------------------------------------------------------------------
// Dedupe shape: three events naming one checkoutForm.id -> one hydration
// ---------------------------------------------------------------------------

test('three events naming one checkoutForm.id produce exactly one hydration call', async () => {
  await resetRun('t-dedupe');
  const { body: pushed } = await call('POST', `/__stub/tenants/${TENANT_A}/orders`, {
    token: null,
    body: { count: 1, lineItemsPerOrder: 2, eventsPerOrder: 3 },
  });
  assert.equal(pushed.minted.length, 1);
  const checkoutFormId = pushed.minted[0].checkoutFormId;

  const { body: eventsPage } = await call('GET', '/order/events?limit=100', { token: TOKEN_A });
  assert.equal(eventsPage.events.length, 3);
  const distinctCheckoutForms = new Set(eventsPage.events.map((e) => e.order.checkoutForm.id));
  assert.equal(distinctCheckoutForms.size, 1);
  assert.equal([...distinctCheckoutForms][0], checkoutFormId);

  // Client-side dedupe (allegro-order-source.adapter.ts) picks the highest
  // event id per checkoutForm.id and hydrates it exactly once.
  const winner = eventsPage.events.reduce((a, b) => (a.id > b.id ? a : b));
  const { status: hydrateStatus } = await call(
    'GET',
    `/order/checkout-forms/${encodeURIComponent(winner.order.checkoutForm.id)}`,
    { token: TOKEN_A }
  );
  assert.equal(hydrateStatus, 200);

  const { body: stats } = await call('GET', `/__stub/tenants/${TENANT_A}/stats`, { token: null });
  assert.equal(stats.requestCounts['GET /order/events'], 1);
  assert.equal(stats.requestCounts['GET /order/checkout-forms/:id'], 1);
});

// ---------------------------------------------------------------------------
// Request count: 1 per poll tick + 1 per ingested order + 0 per line item
// ---------------------------------------------------------------------------

test('request count is 1 per /order/events call plus 1 per hydration, zero per line item', async () => {
  await resetRun('t-cost-model');
  await call('POST', `/__stub/tenants/${TENANT_A}/orders`, {
    token: null,
    body: { count: 3, lineItemsPerOrder: 8, eventsPerOrder: 1 },
  });

  const { body: eventsPage } = await call('GET', '/order/events?limit=100', { token: TOKEN_A });
  assert.equal(eventsPage.events.length, 3);

  for (const event of eventsPage.events) {
    await call('GET', `/order/checkout-forms/${encodeURIComponent(event.order.checkoutForm.id)}`, {
      token: TOKEN_A,
    });
  }

  const { body: stats } = await call('GET', `/__stub/tenants/${TENANT_A}/stats`, { token: null });
  // One /order/events call was made above (the dedupe test's own reset
  // cleared prior counts).
  assert.equal(stats.requestCounts['GET /order/events'], 1);
  assert.equal(stats.requestCounts['GET /order/checkout-forms/:id'], 3);
  assert.equal(stats.ordersPushed, 3);
});

// ---------------------------------------------------------------------------
// Ids are run-scoped: monotone within a run, disjoint across a new run
// ---------------------------------------------------------------------------

test('ids are monotone while the run id is held constant, and disjoint when it changes', async () => {
  const runA = await resetRun('t-run-a');
  await call('POST', `/__stub/tenants/${TENANT_A}/orders`, {
    token: null,
    body: { count: 2 },
  });
  const { body: firstPage } = await call('GET', '/order/events?limit=100', { token: TOKEN_A });
  const firstIds = firstPage.events.map((e) => e.id);
  assert.equal(firstIds.length, 2);
  assert.ok(firstIds[0] < firstIds[1], 'ids must strictly increase within one run');
  for (const id of firstIds) assert.ok(id.startsWith(`${runA}-`));

  const runB = await resetRun('t-run-b');
  assert.notEqual(runA, runB);
  await call('POST', `/__stub/tenants/${TENANT_A}/orders`, {
    token: null,
    body: { count: 2 },
  });
  const { body: secondPage } = await call('GET', '/order/events?limit=100', { token: TOKEN_A });
  const secondIds = secondPage.events.map((e) => e.id);

  for (const id of secondIds) {
    assert.ok(!firstIds.includes(id), 'a new run must never reissue a prior run\'s ids');
    assert.ok(id.startsWith(`${runB}-`));
  }
});

// ---------------------------------------------------------------------------
// Cursor shape is unrecognised by the real regression guard
// (order-cursor.types.ts: DECIMAL_COUNTER / ISO_INSTANT / NAIVE_WALL_CLOCK /
// WALL_CLOCK_KEYSET). Minted ids must match none of the four.
// ---------------------------------------------------------------------------

test('minted event ids match none of the four recognised cursor shapes', async () => {
  await resetRun('t-cursor-shape');
  await call('POST', `/__stub/tenants/${TENANT_A}/orders`, { token: null, body: { count: 1 } });
  const { body } = await call('GET', '/order/events?limit=10', { token: TOKEN_A });
  const id = body.events[0].id;

  const DECIMAL_COUNTER = /^[0-9]+$/;
  const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
  const NAIVE_WALL_CLOCK = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
  const WALL_CLOCK_KEYSET = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\|([0-9]+)$/;

  assert.ok(!DECIMAL_COUNTER.test(id));
  assert.ok(!ISO_INSTANT.test(id));
  assert.ok(!NAIVE_WALL_CLOCK.test(id));
  assert.ok(!WALL_CLOCK_KEYSET.test(id));
});

// ---------------------------------------------------------------------------
// Totals reconcile
// ---------------------------------------------------------------------------

test('totals reconcile: totalToPay = sum(line price * qty) + delivery cost', async () => {
  await resetRun('t-totals');
  await call('POST', `/__stub/tenants/${TENANT_A}/orders`, {
    token: null,
    body: { count: 1, lineItemsPerOrder: 4 },
  });
  const { body: eventsPage } = await call('GET', '/order/events?limit=10', { token: TOKEN_A });
  const checkoutFormId = eventsPage.events[0].order.checkoutForm.id;
  const { body: form } = await call(
    'GET',
    `/order/checkout-forms/${encodeURIComponent(checkoutFormId)}`,
    { token: TOKEN_A }
  );

  const subtotal = form.lineItems.reduce(
    (sum, li) => sum + Number(li.price.amount) * li.quantity,
    0
  );
  const deliveryCost = Number(form.delivery.cost.amount);
  const expectedTotal = Number((subtotal + deliveryCost).toFixed(2));
  assert.equal(Number(form.summary.totalToPay.amount), expectedTotal);
  assert.notEqual(form.status, 'CANCELLED');
  assert.notEqual(form.fulfillment.status, 'CANCELLED');
});

// ---------------------------------------------------------------------------
// Distinct buyers -> distinct masked-email fixed parts
// ---------------------------------------------------------------------------

test('distinct buyers produce distinct masked-email fixed parts', async () => {
  await resetRun('t-buyers');
  await call('POST', `/__stub/tenants/${TENANT_A}/orders`, {
    token: null,
    body: { count: 5 },
  });
  const { body: eventsPage } = await call('GET', '/order/events?limit=10', { token: TOKEN_A });

  const fixedParts = new Set();
  for (const event of eventsPage.events) {
    const { body: form } = await call(
      'GET',
      `/order/checkout-forms/${encodeURIComponent(event.order.checkoutForm.id)}`,
      { token: TOKEN_A }
    );
    // The normalizer strips everything from '+' onward before hashing any
    // @allegromail. address - only the part before '+' may vary if the
    // intent is distinct buyers.
    const fixedPart = form.buyer.email.split('+')[0];
    fixedParts.add(fixedPart);
  }
  assert.equal(fixedParts.size, 5, 'each order should mint a distinct buyer fixedPart');
});

// ---------------------------------------------------------------------------
// Offer ids: {tenant}-offer-{n}, n within the configured pool size
// ---------------------------------------------------------------------------

test('offer ids fall inside 1..STUB_OFFER_POOL_SIZE and carry the tenant label', async () => {
  await resetRun('t-offers');
  await call('POST', `/__stub/tenants/${TENANT_A}/orders`, {
    token: null,
    body: { count: 1, lineItemsPerOrder: 3 },
  });
  const { body: eventsPage } = await call('GET', '/order/events?limit=10', { token: TOKEN_A });
  const { body: form } = await call(
    'GET',
    `/order/checkout-forms/${encodeURIComponent(eventsPage.events[0].order.checkoutForm.id)}`,
    { token: TOKEN_A }
  );

  const offerPattern = new RegExp(`^${TENANT_A}-offer-(\\d+)$`);
  for (const line of form.lineItems) {
    const match = offerPattern.exec(line.offer.id);
    assert.ok(match, `offer id ${line.offer.id} must match {tenant}-offer-{n}`);
    const n = Number(match[1]);
    assert.ok(n >= 1 && n <= CONFIG.offerPoolSize);
    // sku is the same value as offer.id and is not tracked separately -
    // there is nothing further to assert here, matching #2856's note that
    // sku is not an independent axis.
  }
});

// ---------------------------------------------------------------------------
// Multi-tenancy: independent state per bearer token
// ---------------------------------------------------------------------------

test('two tenants keep independent cursor state, order ids and failure controls', async () => {
  await resetRun('t-multi-tenant');
  await call('POST', `/__stub/tenants/${TENANT_A}/orders`, { token: null, body: { count: 2 } });
  await call('POST', `/__stub/tenants/${TENANT_B}/orders`, { token: null, body: { count: 1 } });

  const { body: pageA } = await call('GET', '/order/events?limit=100', { token: TOKEN_A });
  const { body: pageB } = await call('GET', '/order/events?limit=100', { token: TOKEN_B });
  assert.equal(pageA.events.length, 2);
  assert.equal(pageB.events.length, 1);

  await call('POST', `/__stub/tenants/${TENANT_A}/fault`, { token: null, body: { mode: '429' } });
  const { status: statusA } = await call('GET', '/order/events', { token: TOKEN_A });
  const { status: statusB } = await call('GET', '/order/events', { token: TOKEN_B });
  assert.equal(statusA, 429);
  assert.equal(statusB, 200, 'a fault on tenant A must not affect tenant B');

  await call('DELETE', `/__stub/tenants/${TENANT_A}/fault`, { token: null });
});

// ---------------------------------------------------------------------------
// Fault injection: 429/503 carry Retry-After and a parseable error body
// ---------------------------------------------------------------------------

test('429 and 503 carry Retry-After and a parseable Allegro-shaped error body', async () => {
  await resetRun('t-faults');

  for (const mode of ['429', '503']) {
    await call('POST', `/__stub/tenants/${TENANT_A}/fault`, {
      token: null,
      body: { mode, retryAfterSeconds: 3 },
    });
    const { status, headers, body } = await call('GET', '/order/events', { token: TOKEN_A });
    assert.equal(status, Number(mode));
    assert.equal(headers.get('retry-after'), '3');
    assert.ok(Array.isArray(body.errors));
    assert.ok(body.errors[0].code);
    assert.ok(body.errors[0].message);
  }

  await call('DELETE', `/__stub/tenants/${TENANT_A}/fault`, { token: null });
});

test('timeout fault holds the response rather than answering immediately', async () => {
  await resetRun('t-timeout');
  await call('POST', `/__stub/tenants/${TENANT_A}/fault`, {
    token: null,
    body: { mode: 'timeout', holdMs: 200 },
  });

  const startedAt = Date.now();
  const { status } = await call('GET', '/order/events', { token: TOKEN_A });
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed >= 200, `expected the response to be held at least 200ms, got ${elapsed}ms`);
  assert.equal(status, 503);

  await call('DELETE', `/__stub/tenants/${TENANT_A}/fault`, { token: null });
});

// ---------------------------------------------------------------------------
// /me answers for the connection tester
// ---------------------------------------------------------------------------

test('GET /me answers 200 with an id and login', async () => {
  await resetRun('t-me');
  const { status, body } = await call('GET', '/me', { token: TOKEN_A });
  assert.equal(status, 200);
  assert.ok(body.id);
  assert.ok(body.login);
});

// ---------------------------------------------------------------------------
// Everything else 404s in Allegro's own error shape
// ---------------------------------------------------------------------------

test('an unserved path 404s in the Allegro error shape', async () => {
  const { status, body } = await call('GET', '/sale/offer-events', { token: TOKEN_A });
  assert.equal(status, 404);
  assert.ok(Array.isArray(body.errors));
  assert.equal(body.errors[0].code, 'NotFound');
});
