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
    ['PUT', '/sale/offer-quantity-change-commands/does-not-matter', TOKEN_A],
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
// Buyer NAMES carry no digits, and are still distinct per pool slot
//
// Found live by F1 (#2847): PrestaShop validates a customer's firstname and
// lastname with `Validate::isName`, which rejects digits outright, so a
// lastName of `Number42` answered HTTP 400 code 85 on every destination
// create - and because OrderSyncService fans out under Promise.allSettled the
// job still recorded `outcome: 'ok'` while the shop received nothing. This
// asserts both halves of the fix, because dropping the digits without keeping
// the slots distinct would silently collapse the buyer pool the stub's own
// identity decision depends on.
// ---------------------------------------------------------------------------

test('buyer names carry no digits and stay distinct per pool slot', async () => {
  await resetRun('t-buyer-names');
  await call('POST', `/__stub/tenants/${TENANT_A}/orders`, {
    token: null,
    body: { count: 30 },
  });
  const { body: eventsPage } = await call('GET', '/order/events?limit=50', { token: TOKEN_A });

  const names = new Set();
  for (const event of eventsPage.events) {
    const { body: form } = await call(
      'GET',
      `/order/checkout-forms/${encodeURIComponent(event.order.checkoutForm.id)}`,
      { token: TOKEN_A }
    );
    assert.ok(
      !/[0-9]/.test(form.buyer.firstName),
      `buyer.firstName must contain no digit (PrestaShop Validate::isName), got ${form.buyer.firstName}`
    );
    assert.ok(
      !/[0-9]/.test(form.buyer.lastName),
      `buyer.lastName must contain no digit (PrestaShop Validate::isName), got ${form.buyer.lastName}`
    );
    names.add(`${form.buyer.firstName} ${form.buyer.lastName}`);
  }
  // 30 orders against the default 50-slot pool: every slot is still distinct,
  // so the letter encoding did not collapse the pool.
  assert.equal(names.size, 30, 'each pool slot should still render a distinct name');
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
// #2935 - the one synchronous write updateOfferQuantity makes
// ---------------------------------------------------------------------------

test('PUT /sale/offer-quantity-change-commands/{id} echoes the id back as ACCEPTED', async () => {
  await resetRun('t-quantity');
  const { status, body } = await call('PUT', '/sale/offer-quantity-change-commands/abc-123', {
    token: TOKEN_A,
    body: {
      modification: { changeType: 'FIXED', value: 7 },
      offerCriteria: [{ offers: [{ id: 'perf-allegro-a-offer-1' }], type: 'CONTAINS_OFFERS' }],
    },
  });
  assert.equal(status, 200);
  assert.equal(body.id, 'abc-123');
  assert.equal(body.status, 'ACCEPTED');
});

test('PUT /sale/offer-quantity-change-commands/{id} accepts an empty body too (no body sent)', async () => {
  await resetRun('t-quantity-nobody');
  const { status, body } = await call('PUT', '/sale/offer-quantity-change-commands/xyz-789', {
    token: TOKEN_A,
  });
  assert.equal(status, 200);
  assert.equal(body.id, 'xyz-789');
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

// ---------------------------------------------------------------------------
// #2978 fault-injection extensions: endpoint targeting, a fraction, and the
// three new modes. Every one of these is a measurement input for F10, so a
// rule that installs but never fires would spend a window and report nothing.
// ---------------------------------------------------------------------------

/** Installs a fault rule on tenant A and returns the rule the stub stored. */
async function setFault(faultBody) {
  const { body } = await call('POST', `/__stub/tenants/${TENANT_A}/fault`, { token: null, body: faultBody });
  return body.fault;
}
async function clearFault() {
  await call('DELETE', `/__stub/tenants/${TENANT_A}/fault`, { token: null });
}
async function statsA() {
  const { body } = await call('GET', `/__stub/tenants/${TENANT_A}/stats`, { token: null });
  return body;
}

test('a rule naming no endpoints still faults every endpoint (pre-#2978 behaviour is unchanged)', async () => {
  await resetRun('t-2978-allends');
  const rule = await setFault({ mode: '503' });
  assert.equal(rule.endpoints, null, 'an unnamed endpoints list is stored as null, not as an empty array');
  assert.equal(rule.fraction, 1, 'an unnamed fraction defaults to 1');
  assert.equal((await call('GET', '/order/events', { token: TOKEN_A })).status, 503);
  assert.equal((await call('GET', '/order/checkout-forms/x', { token: TOKEN_A })).status, 503);
  assert.equal((await call('PUT', '/sale/offer-quantity-change-commands/x', { token: TOKEN_A })).status, 503);
  await clearFault();
});

test('endpoint targeting faults ONLY the named endpoint - the hydration-fault shape', async () => {
  await resetRun('t-2978-targeted');
  // This is exactly F10's "the source times out during hydration": the feed
  // must keep answering or nothing is ever hydrated and the fault measures
  // nothing at all.
  await setFault({ mode: '503', endpoints: ['checkout'] });
  assert.equal((await call('GET', '/order/events', { token: TOKEN_A })).status, 200, 'the feed still answers');
  assert.equal(
    (await call('GET', '/order/checkout-forms/nope', { token: TOKEN_A })).status,
    503,
    'hydration is faulted',
  );
  assert.equal(
    (await call('PUT', '/sale/offer-quantity-change-commands/x', { token: TOKEN_A })).status,
    200,
    'an unnamed endpoint is untouched',
  );
  const s = await statsA();
  assert.equal(s.faultsApplied, 1, 'only the targeted request counts as a delivered fault');
  await clearFault();
});

test('an endpoint excluded by targeting does not consume a fraction draw', async () => {
  await resetRun('t-2978-nodraw');
  // fraction 1 on `quantity` only: 20 feed reads must all succeed AND must
  // leave faultsApplied at 0. If the draw ran before the endpoint test this
  // would still pass on status, so the counter is the real assertion.
  await setFault({ mode: '503', endpoints: ['quantity'], fraction: 1 });
  for (let i = 0; i < 20; i += 1) {
    assert.equal((await call('GET', '/order/events', { token: TOKEN_A })).status, 200);
  }
  assert.equal((await statsA()).faultsApplied, 0, 'no draw was consumed by an untargeted endpoint');
  await clearFault();
});

test('fraction is a per-request coin flip, and the DELIVERED count is reported', async () => {
  await resetRun('t-2978-fraction');
  await setFault({ mode: '503', endpoints: ['events'], fraction: 0.5 });
  let faulted = 0;
  for (let i = 0; i < 200; i += 1) {
    if ((await call('GET', '/order/events', { token: TOKEN_A })).status === 503) faulted += 1;
  }
  // A wide band on purpose - this asserts the flip is a flip, not that 200
  // draws land near the mean. It catches "always" and "never" immediately.
  assert.ok(faulted > 70 && faulted < 130, `fraction 0.5 faulted ${faulted} of 200 (expected 70..130)`);
  assert.equal((await statsA()).faultsApplied, faulted, 'the reported delivered count matches what was served');
  await clearFault();
});

test('installing a rule resets the delivered-fault counter', async () => {
  await resetRun('t-2978-counterreset');
  await setFault({ mode: '503', endpoints: ['events'] });
  await call('GET', '/order/events', { token: TOKEN_A });
  assert.equal((await statsA()).faultsApplied, 1);
  await setFault({ mode: '429', endpoints: ['events'] });
  assert.equal((await statsA()).faultsApplied, 0, 'the counter belongs to the ACTIVE rule, not to the process');
  await clearFault();
  assert.equal((await statsA()).faultsApplied, 0, 'DELETE clears it too');
});

test("the 'malformed' mode answers 200 with a body that is not JSON", async () => {
  await resetRun('t-2978-malformed');
  await setFault({ mode: 'malformed', endpoints: ['checkout'] });
  const r = await call('GET', '/order/checkout-forms/anything', { token: TOKEN_A });
  assert.equal(r.status, 200, 'the transport succeeds - that is the point of this fault');
  assert.equal(r.headers.get('content-type'), 'application/json', 'it still CLAIMS to be JSON');
  assert.equal(r.body, undefined, 'the body did not parse as JSON');
  assert.ok(r.raw.includes('Fatal error'), 'the body is the html-error shape a broken PHP upstream returns');
  await clearFault();
});

test("the 'truncated' mode closes the socket mid-body", async () => {
  await resetRun('t-2978-truncated');
  await setFault({ mode: 'truncated', endpoints: ['events'] });
  // fetch surfaces a premature close as a thrown TypeError rather than as a
  // short body, which is precisely the difference from `malformed`.
  await assert.rejects(
    async () => {
      const res = await fetch(`${baseUrl}/order/events`, { headers: { Authorization: `Bearer ${TOKEN_A}` } });
      await res.text();
    },
    (err) => err instanceof Error,
    'a truncated response must fail at the transport layer, not parse as a short document',
  );
  await clearFault();
});

test("the 'reject-quantity' mode answers HTTP 200 carrying status REJECTED", async () => {
  await resetRun('t-2978-reject');
  await setFault({ mode: 'reject-quantity' });
  const r = await call('PUT', '/sale/offer-quantity-change-commands/cmd-7', { token: TOKEN_A });
  assert.equal(r.status, 200, 'the HTTP layer succeeds - a caller reading only the status sees success');
  assert.equal(r.body.status, 'REJECTED');
  assert.equal(r.body.id, 'cmd-7', 'the command id is echoed, as the real response does');
  assert.ok(Array.isArray(r.body.errors) && r.body.errors.length > 0, 'a rejection carries errors');
  await clearFault();
});

test("'reject-quantity' does not match a non-quantity endpoint, and does not count as delivered", async () => {
  await resetRun('t-2978-reject-scope');
  await setFault({ mode: 'reject-quantity' });
  const r = await call('GET', '/order/events', { token: TOKEN_A });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.events), 'the feed is served normally, not given an invented rejection shape');
  assert.equal((await statsA()).faultsApplied, 0, 'a non-matching endpoint is not counted as a delivered fault');
  await clearFault();
});

test('the control surface refuses an unknown mode, a bad endpoint and a bad fraction', async () => {
  const bad = await call('POST', `/__stub/tenants/${TENANT_A}/fault`, { token: null, body: { mode: 'nonsense' } });
  assert.equal(bad.status, 400);
  const badEndpoint = await call('POST', `/__stub/tenants/${TENANT_A}/fault`, {
    token: null,
    body: { mode: '503', endpoints: ['orders'] },
  });
  assert.equal(badEndpoint.status, 400, 'an endpoint this stub does not serve is refused, not silently ignored');
  const badFraction = await call('POST', `/__stub/tenants/${TENANT_A}/fault`, {
    token: null,
    body: { mode: '503', fraction: 1.5 },
  });
  assert.equal(badFraction.status, 400);
  assert.equal(
    (await call('GET', `/__stub/tenants/${TENANT_A}/stats`, { token: null })).body.fault,
    null,
    'none of the refused rules was installed',
  );
});

// ---------------------------------------------------------------------------
// #3043 (F17, #3047) - customer-returns feed
// ---------------------------------------------------------------------------

test('GET /order/customer-returns starts empty for a fresh run', async () => {
  await resetRun('t-3043-returns-empty');
  const { status, body } = await call('GET', '/order/customer-returns?limit=10', { token: TOKEN_A });
  assert.equal(status, 200);
  assert.deepEqual(body.customerReturns, []);
});

test('seeding returns via the control surface surfaces them in the feed and by id - VALID', async () => {
  await resetRun('t-3043-returns-seed');
  const seed = await call('POST', `/__stub/tenants/${TENANT_A}/returns`, {
    token: null,
    body: { count: 3, itemsPerReturn: 2 },
  });
  assert.equal(seed.status, 201);
  assert.equal(seed.body.minted.length, 3);

  const page = await call('GET', '/order/customer-returns?limit=10', { token: TOKEN_A });
  assert.equal(page.status, 200);
  assert.equal(page.body.customerReturns.length, 3);
  assert.equal(page.body.customerReturns[0].items.length, 2);

  const oneId = seed.body.minted[0];
  const one = await call('GET', `/order/customer-returns/${oneId}`, { token: TOKEN_A });
  assert.equal(one.status, 200);
  assert.equal(one.body.id, oneId);
});

test('the `from` cursor pages past already-seen returns, not from the start', async () => {
  await resetRun('t-3043-returns-cursor');
  const seed = await call('POST', `/__stub/tenants/${TENANT_A}/returns`, {
    token: null,
    body: { count: 5 },
  });
  const firstPage = await call('GET', '/order/customer-returns?limit=2', { token: TOKEN_A });
  assert.equal(firstPage.body.customerReturns.length, 2);
  const lastSeenId = firstPage.body.customerReturns[1].id;

  const secondPage = await call('GET', `/order/customer-returns?limit=2&from=${lastSeenId}`, { token: TOKEN_A });
  assert.equal(secondPage.body.customerReturns.length, 2);
  assert.notEqual(secondPage.body.customerReturns[0].id, firstPage.body.customerReturns[0].id);
  assert.notEqual(secondPage.body.customerReturns[0].id, firstPage.body.customerReturns[1].id);
  void seed;
});

test('an unknown `from` cursor answers an empty page, never a replay of full history - DISCARDED', async () => {
  await resetRun('t-3043-returns-unknown-cursor');
  await call('POST', `/__stub/tenants/${TENANT_A}/returns`, { token: null, body: { count: 3 } });
  const page = await call('GET', '/order/customer-returns?limit=10&from=never-seen-id', { token: TOKEN_A });
  assert.equal(page.status, 200);
  assert.deepEqual(page.body.customerReturns, []);
});

test('GET /order/customer-returns/:id for an unknown id answers 404 in Allegro error shape - DISCARDED', async () => {
  await resetRun('t-3043-returns-404');
  const { status, body } = await call('GET', '/order/customer-returns/never-created', { token: TOKEN_A });
  assert.equal(status, 404);
  assert.equal(body.errors[0].code, 'NotFound');
});

test('a fault rule scoped to `returns` faults the returns feed and nothing else', async () => {
  await resetRun('t-3043-returns-fault');
  await setFault({ mode: '503', endpoints: ['returns'] });
  const returns = await call('GET', '/order/customer-returns?limit=10', { token: TOKEN_A });
  assert.equal(returns.status, 503);
  const events = await call('GET', '/order/events', { token: TOKEN_A });
  assert.equal(events.status, 200, 'a rule scoped to returns must not fault the unrelated events feed');
  await clearFault();
});
