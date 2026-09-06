#!/usr/bin/env node
'use strict';

/**
 * Allegro upstream stub - #2856.
 *
 * Serves the two Allegro Public API endpoints OpenLinker's order-ingestion
 * path actually calls (GET /order/events, GET /order/checkout-forms/{id}),
 * plus GET /me for the connection tester, plus a driver-facing control
 * surface under /__stub/. Everything else answers 404 in Allegro's own error
 * shape, so a stray call fails loudly (404 is non-retryable per
 * allegro-retry-classifier.adapter.ts) instead of looping.
 *
 * This file is standalone node:http with zero dependencies, deliberately.
 * `pnpm-workspace.yaml` globs only apps/*, libs/* and libs/integrations/*,
 * so perf/openlinker-throughput/stubs/allegro is not a workspace member and
 * cannot be a pnpm package without editing that file - and the
 * perf/prestashop-baseline precedent ships no package.json either. See
 * README.md for the full list of design decisions and their reasons.
 *
 * Every design decision below is traceable to a numbered section of GitHub
 * issue #2856 (openlinker-project/openlinker); comments cite it as "#2856".
 */

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { URL, fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * #2856 "Event ids must be run-scoped, or repeatability breaks silently":
 * eventKey becomes a Redis jobdedup:* key with a 7-day TTL, so a repeated
 * campaign run within that window must NOT reissue ids the first run already
 * reserved, or every enqueue silently no-ops. The run id is the free
 * variable a driver controls (via STUB_RUN_ID at boot, or POST /__stub/run
 * at any point in the process lifetime) precisely so it CAN mint a fresh id
 * space per repeat without restarting the container.
 */
function generateRunId() {
  return `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
}

function parseTenants(spec) {
  // "token=name,token=name". Kept human-addressable by NAME on the control
  // surface (see resolveTenantByName) so a driver script never has to quote
  // a bearer secret into a URL path.
  const map = new Map();
  for (const pair of spec.split(',')) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const token = trimmed.slice(0, eq).trim();
    const name = trimmed.slice(eq + 1).trim();
    if (token && name) map.set(token, name);
  }
  return map;
}

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

const CONFIG = {
  port: envInt('STUB_PORT', 8080),
  runId: process.env.STUB_RUN_ID || generateRunId(),
  gitSha: process.env.STUB_GIT_SHA || 'unknown',
  tenants: parseTenants(
    process.env.STUB_TENANTS || 'stub-token-a=perf-allegro-a,stub-token-b=perf-allegro-b'
  ),
  latencyDefaultMs: envInt('STUB_PER_REQUEST_LATENCY_MS', 120),
  latencyEventsMs: process.env.STUB_LATENCY_EVENTS_MS,
  latencyCheckoutMs: process.env.STUB_LATENCY_CHECKOUT_MS,
  // #2856 "The seeded-mapping contract": offer ids must be a deterministic
  // function of tenant + index so #2860's bootstrap can pre-seed
  // identifier_mappings rows before any order is ever pushed. This value
  // MUST equal ALLEGRO_OFFER_POOL_SIZE in that bootstrap - see README.
  offerPoolSize: envInt('STUB_OFFER_POOL_SIZE', 200),
  // #2856 "The buyer-identity decision": distinct masked-email fixed parts
  // are required to avoid collapsing every synthetic order onto one internal
  // customer under the default email_fallback identity mode. This knob lets
  // a driver choose "cold" (large pool, ~1 buyer per order) vs "warm"
  // (small pool, repeat buyers) as a declared measurement input.
  buyerPoolSize: envInt('STUB_BUYER_POOL_SIZE', 50),
  deliveryCostAmount: process.env.STUB_DELIVERY_COST || '9.99',
};

function latencyFor(endpoint) {
  if (endpoint === 'events' && CONFIG.latencyEventsMs !== undefined) {
    return envInt('STUB_LATENCY_EVENTS_MS', CONFIG.latencyDefaultMs);
  }
  if (endpoint === 'checkout' && CONFIG.latencyCheckoutMs !== undefined) {
    return envInt('STUB_LATENCY_CHECKOUT_MS', CONFIG.latencyDefaultMs);
  }
  return CONFIG.latencyDefaultMs;
}

// ---------------------------------------------------------------------------
// State - one process, N tenants, keyed by bearer token (#2856 Multi-tenancy)
// ---------------------------------------------------------------------------

function freshTenantState(name) {
  return {
    name,
    // seq is the per-tenant, per-run monotone event counter. It resets to 0
    // whenever /__stub/run mints a new run id for the whole process, which
    // is the "simulated restart" the tests below exercise. While the run id
    // stays constant, seq only ever increases - that is the "monotone
    // across a restart when the run id is held constant" property: a run
    // is, by definition, one contiguous increasing sequence.
    seq: 0,
    events: [], // { id, seq, order, occurredAt, type }
    checkoutForms: new Map(), // checkoutFormId -> AllegroCheckoutForm
    orderCounter: 0,
    lineCounter: 0, // drives round-robin offer assignment across the pool
    fault: null, // { mode: '429'|'503'|'timeout', retryAfterSeconds, holdMs }
    requestCounts: {}, // 'GET /order/events' -> n
  };
}

const state = {
  runId: CONFIG.runId,
  tenants: new Map(), // token -> tenant state
  unknown: freshTenantState('unknown'),
};

for (const [token, name] of CONFIG.tenants) {
  state.tenants.set(token, freshTenantState(name));
}

function resolveTenantByToken(authorizationHeader) {
  // #2856 Multi-tenancy: "An unknown token still serves (never 401) but
  // under an `unknown` tenant label, logged as such." Never 401 anywhere -
  // Problem/Context: a 401 whose body mentions a token sends OpenLinker's
  // real adapter down the hardcoded allegro.pl OAuth refresh path.
  if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
    return { token: null, tenant: state.unknown };
  }
  const token = authorizationHeader.slice('Bearer '.length).trim();
  const tenant = state.tenants.get(token);
  if (!tenant) return { token, tenant: state.unknown };
  return { token, tenant };
}

function resolveTenantByName(name) {
  for (const tenant of state.tenants.values()) {
    if (tenant.name === name) return tenant;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Order minting - the driver pushes, the stub never self-generates
// (#2856 "Order minting: the driver pushes, the stub does not self-generate")
// ---------------------------------------------------------------------------

function priceForOffer(offerIndex) {
  // Deterministic function of the offer index, purely so totals vary a
  // little between line items rather than being a single repeated constant -
  // not a modelling requirement, just makes a manifest's numbers look real.
  return Number((9.99 + (offerIndex % 20) * 1.5).toFixed(2));
}

function buyerFor(orderN) {
  const idx = orderN % CONFIG.buyerPoolSize; // 0-based
  const buyerNumber = idx + 1;
  return {
    id: `buyer-${buyerNumber}`,
    // #2856 "The rule for the stub: vary the masked-email fixedPart per
    // synthetic buyer... do not vary only the +transactionId suffix and
    // expect distinct customers, since that is exactly what the normalizer
    // erases" (allegro-email-normalizer.adapter.ts strips +suffix before
    // hashing any @allegromail. address). The fixedPart here is
    // `buyer{N}`, distinct per pool slot; the +tx suffix varies per order
    // and is deliberately included BECAUSE it must be irrelevant.
    email: `buyer${buyerNumber}+tx${orderN}@allegromail.pl`,
    login: `buyer${buyerNumber}`,
    firstName: 'Buyer',
    lastName: `Number${buyerNumber}`,
    phoneNumber: '+48000000000',
    address: {
      street: `ul. Testowa ${buyerNumber}`,
      city: 'Warsaw',
      zipCode: '00-001',
      countryCode: 'PL',
    },
  };
}

function mintCheckoutForm(tenant, tenantLabel, orderN, lineItemsPerOrder) {
  const checkoutFormId = `${state.runId}-${tenantLabel}-order-${orderN}`;
  const buyer = buyerFor(orderN);
  const now = new Date().toISOString();

  const lineItems = [];
  let subtotal = 0;
  for (let i = 0; i < lineItemsPerOrder; i += 1) {
    tenant.lineCounter += 1;
    // #2856 "The seeded-mapping contract": offer ids are `{tenant}-offer-{n}`
    // for n in 1..STUB_OFFER_POOL_SIZE, matching #2860's bootstrap seeder
    // exactly - sku is the same value (allegro-order-source.adapter.ts:802),
    // so it is not tracked as a separate axis.
    const offerIndex = ((tenant.lineCounter - 1) % CONFIG.offerPoolSize) + 1;
    const offerId = `${tenantLabel}-offer-${offerIndex}`;
    const unitPrice = priceForOffer(offerIndex);
    subtotal = Number((subtotal + unitPrice).toFixed(2));
    lineItems.push({
      id: `${checkoutFormId}-line-${i + 1}`,
      offer: { id: offerId, name: `Stub offer ${offerIndex}` },
      quantity: 1,
      price: { amount: unitPrice.toFixed(2), currency: 'PLN' },
      boughtAt: now,
    });
  }

  const deliveryCost = Number(CONFIG.deliveryCostAmount);
  const total = Number((subtotal + deliveryCost).toFixed(2));

  /** @type {import('./allegro-checkout-form-shape').AllegroCheckoutForm} */
  const checkoutForm = {
    id: checkoutFormId,
    // Neither status nor fulfillment.status may be CANCELLED, or the order
    // ingests as cancelled (#2856, allegro-order-source.adapter.ts:740-742).
    status: 'BOUGHT',
    fulfillment: { status: 'NOWE' },
    buyer,
    payment: { type: 'ONLINE', finishedAt: now },
    lineItems,
    // Totals must reconcile: totalToPay = sum(line price * qty) + delivery
    // cost, or the order-record total the seeded-mapping AC checks against
    // won't match what was minted here.
    summary: { totalToPay: { amount: total.toFixed(2), currency: 'PLN' } },
    delivery: {
      cost: { amount: deliveryCost.toFixed(2), currency: 'PLN' },
      address: {
        firstName: buyer.firstName,
        lastName: buyer.lastName,
        street: buyer.address.street,
        city: buyer.address.city,
        zipCode: buyer.address.zipCode,
        countryCode: buyer.address.countryCode,
      },
    },
    updatedAt: now,
  };

  tenant.checkoutForms.set(checkoutFormId, checkoutForm);
  return checkoutForm;
}

const EVENT_TYPE_CYCLE = ['BOUGHT', 'FILLED_IN', 'READY_FOR_PROCESSING'];

function pushOrders(tenant, tenantLabel, { count, lineItemsPerOrder, eventsPerOrder }) {
  const minted = [];
  for (let i = 0; i < count; i += 1) {
    tenant.orderCounter += 1;
    const orderN = tenant.orderCounter;
    const checkoutForm = mintCheckoutForm(tenant, tenantLabel, orderN, lineItemsPerOrder);
    const orderId = `${checkoutForm.id}-order-ref`;

    // Multiple events naming the SAME checkoutForm.id, so a driver can
    // exercise the client-side dedupe-by-checkoutFormId behaviour (#2856:
    // "a stub emitting three events for one order must expect exactly one
    // hydration"). occurredAt increases monotonically across the events so
    // the highest event id is also the chronologically last one.
    for (let e = 0; e < eventsPerOrder; e += 1) {
      tenant.seq += 1;
      const eventId = `${state.runId}-${String(tenant.seq).padStart(6, '0')}`;
      tenant.events.push({
        id: eventId,
        seq: tenant.seq,
        order: { id: orderId, checkoutForm: { id: checkoutForm.id } },
        occurredAt: new Date(Date.now() + e * 1000).toISOString(),
        type: EVENT_TYPE_CYCLE[Math.min(e, EVENT_TYPE_CYCLE.length - 1)],
      });
    }

    minted.push({ checkoutFormId: checkoutForm.id, orderId, orderN });
  }
  return minted;
}

// ---------------------------------------------------------------------------
// Events endpoint - cursor semantics (#2856 "Cursor semantics")
// ---------------------------------------------------------------------------

function parseCursorSeq(cursor) {
  // Our own ids are `{runId}-{6-digit-seq}`. Deliberately NOT a decimal
  // counter (order-cursor.types.ts DECIMAL_COUNTER = /^[0-9]+$/) - the
  // hyphen alone guarantees this shape is "unrecognised" by
  // compareOrderCursors, which treats "unrecognised" as never-a-regression.
  // A decimal-counter shape would ARM that guard, and a stub restart that
  // resets its counter would then trip `regressed` and wedge the connection
  // forever (#2856 "Event ids must be run-scoped, or repeatability breaks
  // silently").
  if (typeof cursor !== 'string') return null;
  const prefix = `${state.runId}-`;
  if (!cursor.startsWith(prefix)) return null;
  const suffix = cursor.slice(prefix.length);
  if (!/^\d+$/.test(suffix)) return null;
  return Number.parseInt(suffix, 10);
}

function listEvents(tenant, fromCursor, limit) {
  let startSeq; // events with seq > startSeq are returned
  let unknownCursor = false;

  if (!fromCursor) {
    startSeq = 0;
  } else {
    const parsed = parseCursorSeq(fromCursor);
    if (parsed === null) {
      // #2856 "Cursor durability across a stub restart. ... Recommended:
      // tolerate an unknown `from` by treating it as the newest known
      // cursor and warning, never 404." We do not replay full history for
      // a cursor we cannot place - that would re-mint hydration work for
      // events the caller may already have processed under a previous run.
      unknownCursor = true;
      startSeq = tenant.seq;
    } else {
      startSeq = parsed;
    }
  }

  const page = tenant.events.filter((e) => e.seq > startSeq).slice(0, limit);
  const lastEventId =
    page.length > 0
      ? page[page.length - 1].id
      : unknownCursor && tenant.events.length > 0
        ? tenant.events[tenant.events.length - 1].id
        : undefined;

  return {
    body: {
      events: page.map((e) => ({
        id: e.id,
        order: e.order,
        occurredAt: e.occurredAt,
        type: e.type,
      })),
      ...(lastEventId !== undefined ? { lastEventId } : {}),
    },
    unknownCursor,
  };
}

// ---------------------------------------------------------------------------
// Fault injection (#2856 "Failure injection")
// ---------------------------------------------------------------------------

function allegroError(code, message) {
  return { errors: [{ code, message }] };
}

/**
 * Applies a tenant's active fault, if any, to the in-flight Allegro-surface
 * request. Returns true if it fully handled the response (caller must do
 * nothing further); false if the caller should proceed to serve a normal
 * response.
 */
function applyFault(tenant, req, res, log) {
  const fault = tenant.fault;
  if (!fault) return false;

  if (fault.mode === '429' || fault.mode === '503') {
    const status = fault.mode === '429' ? 429 : 503;
    const code = fault.mode === '429' ? 'RateLimitExceeded' : 'ServiceUnavailable';
    const retryAfter = fault.retryAfterSeconds ?? 5;
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Retry-After': String(retryAfter),
    });
    res.end(JSON.stringify(allegroError(code, `Injected ${status} fault for tenant ${tenant.name}`)));
    log(status);
    return true;
  }

  if (fault.mode === 'timeout') {
    // Holds the connection open past the client's 30 s abort
    // (allegro-http-client.ts:362-363) by default; a driver testing this
    // in isolation may pass a short holdMs to avoid a real 30+ second wait.
    // We never write a response before holdMs elapses, and if the client
    // is still there afterwards we close the socket rather than leaking it
    // forever - the real client will have long since aborted by then.
    const holdMs = fault.holdMs ?? 31000;
    let responded = false;
    req.on('close', () => {
      responded = true;
    });
    setTimeout(() => {
      if (responded) return;
      responded = true;
      // Nothing reads this in the intended (>30s abort) case; it only
      // matters for a short-holdMs test that wants the request to
      // eventually settle rather than hang the test runner.
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(allegroError('ServiceUnavailable', 'Injected timeout fault settled')));
      log(503);
    }, holdMs);
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(payload);
}

function notFound(res, method, pathname) {
  sendJson(res, 404, allegroError('NotFound', `No route for ${method} ${pathname}`));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function recordRequestCount(tenant, method, pathTemplate) {
  const key = `${method} ${pathTemplate}`;
  tenant.requestCounts[key] = (tenant.requestCounts[key] || 0) + 1;
}

function logLine(fields) {
  // JSON lines on stdout - #2856 Build Specification "The request log":
  // #2854's compose service declares no volume mount, so a file-based log
  // dies with the container.
  process.stdout.write(`${JSON.stringify(fields)}\n`);
}

const server = createServer((req, res) => {
  const startedAt = Date.now();
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const method = req.method || 'GET';
  const pathname = url.pathname;
  const { token, tenant } = resolveTenantByToken(req.headers.authorization);
  const tenantLabel = tenant.name;

  const log = (status, pathTemplate) => {
    logLine({
      ts: new Date().toISOString(),
      runId: state.runId,
      tenant: tenantLabel,
      method,
      path: pathTemplate || pathname,
      status,
      latencyMs: Date.now() - startedAt,
    });
  };

  void handle();

  async function handle() {
    // GET /me - #2856: "GET /me answers, and the connection-test bootstrap
    // check passes." Never 401, never faulted (an operator must always be
    // able to prove the stub is reachable).
    if (method === 'GET' && pathname === '/me') {
      recordRequestCount(tenant, 'GET', '/me');
      await delay(latencyFor('me'));
      sendJson(res, 200, { id: 'seller-1', login: `stub-seller-${tenantLabel}` });
      log(200, '/me');
      return;
    }

    if (method === 'GET' && pathname === '/order/events') {
      recordRequestCount(tenant, 'GET', '/order/events');
      await delay(latencyFor('events'));
      if (applyFault(tenant, req, res, (status) => log(status, '/order/events'))) return;
      const from = url.searchParams.get('from');
      const limitParam = url.searchParams.get('limit');
      const limit = limitParam ? Number.parseInt(limitParam, 10) : 100;
      const { body } = listEvents(tenant, from, Number.isFinite(limit) ? limit : 100);
      sendJson(res, 200, body);
      log(200, '/order/events');
      return;
    }

    const checkoutMatch = /^\/order\/checkout-forms\/([^/]+)$/.exec(pathname);
    if (method === 'GET' && checkoutMatch) {
      recordRequestCount(tenant, 'GET', '/order/checkout-forms/:id');
      await delay(latencyFor('checkout'));
      if (applyFault(tenant, req, res, (status) => log(status, '/order/checkout-forms/:id'))) return;
      const id = decodeURIComponent(checkoutMatch[1]);
      const checkoutForm = tenant.checkoutForms.get(id);
      if (!checkoutForm) {
        notFound(res, method, pathname);
        log(404, '/order/checkout-forms/:id');
        return;
      }
      sendJson(res, 200, checkoutForm);
      log(200, '/order/checkout-forms/:id');
      return;
    }

    // -----------------------------------------------------------------
    // Control surface - /__stub/, driver-facing. No Allegro path uses this
    // prefix (#2856 Build Specification "Control endpoint"). Deliberately
    // unauthenticated: this is a local perf harness control plane, never
    // reached by OpenLinker itself, so there is no principal to check.
    // -----------------------------------------------------------------

    if (method === 'GET' && pathname === '/__stub/health') {
      sendJson(res, 200, { status: 'ok', runId: state.runId });
      return;
    }

    if (method === 'GET' && pathname === '/__stub/config') {
      sendJson(res, 200, {
        runId: state.runId,
        gitSha: CONFIG.gitSha,
        port: CONFIG.port,
        tenants: [...state.tenants.values()].map((t) => t.name),
        offerPoolSize: CONFIG.offerPoolSize,
        buyerPoolSize: CONFIG.buyerPoolSize,
        deliveryCostAmount: CONFIG.deliveryCostAmount,
        latency: {
          defaultMs: CONFIG.latencyDefaultMs,
          eventsMs: latencyFor('events'),
          checkoutMs: latencyFor('checkout'),
        },
      });
      return;
    }

    if (method === 'POST' && pathname === '/__stub/run') {
      let body;
      try {
        body = await readBody(req);
      } catch {
        sendJson(res, 400, { error: 'invalid JSON body' });
        return;
      }
      // #2856 "Event ids must be minted run-scoped, not process-scoped":
      // this is the mechanism that lets a driver run the same scenario
      // twice in one process lifetime and get disjoint dedupe keys the
      // second time, without restarting the container.
      state.runId = typeof body.runId === 'string' && body.runId ? body.runId : generateRunId();
      for (const t of state.tenants.values()) {
        const fresh = freshTenantState(t.name);
        Object.assign(t, fresh);
      }
      Object.assign(state.unknown, freshTenantState('unknown'));
      sendJson(res, 200, { runId: state.runId });
      return;
    }

    const ordersMatch = /^\/__stub\/tenants\/([^/]+)\/orders$/.exec(pathname);
    if (method === 'POST' && ordersMatch) {
      const targetTenant = resolveTenantByName(decodeURIComponent(ordersMatch[1]));
      if (!targetTenant) {
        sendJson(res, 404, { error: `unknown tenant ${ordersMatch[1]}` });
        return;
      }
      let body;
      try {
        body = await readBody(req);
      } catch {
        sendJson(res, 400, { error: 'invalid JSON body' });
        return;
      }
      const count = Number.isInteger(body.count) && body.count > 0 ? body.count : 1;
      const lineItemsPerOrder =
        Number.isInteger(body.lineItemsPerOrder) && body.lineItemsPerOrder > 0
          ? body.lineItemsPerOrder
          : 1;
      const eventsPerOrder =
        Number.isInteger(body.eventsPerOrder) && body.eventsPerOrder > 0 ? body.eventsPerOrder : 1;
      const minted = pushOrders(targetTenant, targetTenant.name, {
        count,
        lineItemsPerOrder,
        eventsPerOrder,
      });
      sendJson(res, 201, { minted });
      return;
    }

    const faultMatch = /^\/__stub\/tenants\/([^/]+)\/fault$/.exec(pathname);
    if (faultMatch && (method === 'POST' || method === 'DELETE')) {
      const targetTenant = resolveTenantByName(decodeURIComponent(faultMatch[1]));
      if (!targetTenant) {
        sendJson(res, 404, { error: `unknown tenant ${faultMatch[1]}` });
        return;
      }
      if (method === 'DELETE') {
        targetTenant.fault = null;
        sendJson(res, 200, { fault: null });
        return;
      }
      let body;
      try {
        body = await readBody(req);
      } catch {
        sendJson(res, 400, { error: 'invalid JSON body' });
        return;
      }
      if (![null, '429', '503', 'timeout'].includes(body.mode)) {
        sendJson(res, 400, { error: "mode must be one of null, '429', '503', 'timeout'" });
        return;
      }
      targetTenant.fault =
        body.mode === null
          ? null
          : {
              mode: body.mode,
              retryAfterSeconds: Number.isInteger(body.retryAfterSeconds)
                ? body.retryAfterSeconds
                : 5,
              holdMs: Number.isInteger(body.holdMs) ? body.holdMs : undefined,
            };
      sendJson(res, 200, { fault: targetTenant.fault });
      return;
    }

    const statsMatch = /^\/__stub\/tenants\/([^/]+)\/stats$/.exec(pathname);
    if (method === 'GET' && statsMatch) {
      const targetTenant = resolveTenantByName(decodeURIComponent(statsMatch[1]));
      if (!targetTenant) {
        sendJson(res, 404, { error: `unknown tenant ${statsMatch[1]}` });
        return;
      }
      sendJson(res, 200, {
        name: targetTenant.name,
        requestCounts: targetTenant.requestCounts,
        ordersPushed: targetTenant.orderCounter,
        eventsEmitted: targetTenant.events.length,
        currentCursor:
          targetTenant.events.length > 0
            ? targetTenant.events[targetTenant.events.length - 1].id
            : null,
        fault: targetTenant.fault,
      });
      return;
    }

    notFound(res, method, pathname);
    log(404);
  }
});

// Only auto-listen when this file is run directly (`node server.mjs`), never
// on import - test.mjs imports this module and calls server.listen(0) itself
// so it gets an ephemeral port instead of colliding with a real instance on
// CONFIG.port.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  server.listen(CONFIG.port, () => {
    logLine({
      ts: new Date().toISOString(),
      event: 'listening',
      runId: state.runId,
      port: CONFIG.port,
      gitSha: CONFIG.gitSha,
      tenants: [...state.tenants.values()].map((t) => t.name),
    });
  });
}

// Exported for test.mjs, which starts/stops the server in-process on an
// ephemeral port rather than shelling out to a second node process.
export { server, CONFIG, state };
