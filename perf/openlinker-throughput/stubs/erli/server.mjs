#!/usr/bin/env node
'use strict';

/**
 * Erli Shop API upstream stub - #3043 (provisioning for F18, epic #2840).
 *
 * A single-process `node:http` stub in the shape of `stubs/allegro/server.mjs`
 * (#2856), serving just enough of the Erli Shop API for OpenLinker's REAL,
 * unmodified `ErliOrderSourceAdapter` / `ErliOfferManagerAdapter`
 * (`@openlinker/integrations-erli`) to construct and run a connection test +
 * an order-feed poll + an offer-quantity write against it.
 *
 * SCOPE, DELIBERATELY MINIMAL: this stub gives #3043 a connection that
 * resolves and passes bootstrap's post-connect verification. It does NOT
 * yet model the two behaviours #3048 (F18) is built to measure -
 * seller-frozen stock (`isStockFrozenCached`, read off a status-sync GET
 * this stub does not yet serve) and the peer-Allegro-catalogue-borrow EAN
 * resolve (which never reaches THIS stub at all - it lands on
 * `stubs/allegro`, on the PEER Allegro connection's own credentials). #3048
 * owns extending this file for the frozen-stock field once it lands.
 */

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { URL, fileURLToPath } from 'node:url';

const PORT = Number(process.env.STUB_PORT || 19085);
const GIT_SHA = process.env.STUB_GIT_SHA || 'unknown';
let LATENCY_MS = Number(process.env.STUB_LATENCY_MS || 0);

// Inbox events - a plain array, oldest first, matching the real wire shape
// `{id, shopId, created, read, type, payload}`.
let inbox = [];
let quantityWritesTotal = 0;
let ordersServedTotal = 0;
let requestsTotal = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

// GET /me - connection tester probe path (ERLI_CONNECTION_PROBE_PATH).
async function handleMe(res) {
  requestsTotal += 1;
  await sleep(LATENCY_MS);
  sendJson(res, 200, { id: 'stub-shop', name: 'perf-lab Erli stub' });
}

// GET /inbox - the order-event journal. Real wire: top-level array, no
// query params, cap 500 unread. This stub serves whatever `seedOrder` (via
// /__stub/seed-order) has appended and never trims.
async function handleInbox(res) {
  requestsTotal += 1;
  await sleep(LATENCY_MS);
  sendJson(res, 200, inbox);
}

// POST /inbox/mark-read - {lastMessageId} high-water-mark ack. This stub
// has no read state to mutate (nothing re-reads the inbox after ack in a
// way this stub needs to model); it just accepts.
async function handleMarkRead(req, res) {
  await readBody(req);
  await sleep(LATENCY_MS);
  sendJson(res, 200, { ok: true });
}

// GET /orders/:id - order hydration. Serves whatever was registered via
// /__stub/seed-order, or a minimal synthetic order shape otherwise so a
// smoke run against an unseeded id does not 404 the whole scenario.
async function handleGetOrder(orderId, res) {
  requestsTotal += 1;
  ordersServedTotal += 1;
  await sleep(LATENCY_MS);
  const seeded = seededOrders.get(orderId);
  sendJson(
    res,
    200,
    seeded ?? {
      id: orderId,
      status: 'NEW',
      createdAt: new Date().toISOString(),
      buyer: { email: 'stub-buyer@example.invalid' },
      lines: [],
      deliveryAddress: { countryCode: 'PL' },
    },
  );
}

// GET/PATCH /products/:id - offer read + quantity write. `stock` is the
// only field `ErliOfferManagerAdapter.updateOfferQuantity` writes.
async function handleGetProduct(id, res) {
  requestsTotal += 1;
  await sleep(LATENCY_MS);
  sendJson(res, 200, { id, stock: 0, status: 'active' });
}

async function handlePatchProduct(req, res) {
  requestsTotal += 1;
  const raw = await readBody(req);
  await sleep(LATENCY_MS);
  quantityWritesTotal += 1;
  let body = {};
  try {
    body = JSON.parse(raw || '{}');
  } catch {
    // tolerate - the adapter always sends valid JSON; a malformed body here
    // would be a driver bug, not something worth failing loudly on.
  }
  sendJson(res, 200, { ok: true, stock: body.stock ?? null });
}

// -----------------------------------------------------------------------
// Test/driver seams - not real Erli endpoints.
// -----------------------------------------------------------------------
const seededOrders = new Map();

async function handleSeedOrder(req, res) {
  const raw = await readBody(req);
  let body;
  try {
    body = JSON.parse(raw || '{}');
  } catch {
    return sendJson(res, 400, { error: 'invalid JSON body' });
  }
  const id = body.id ?? randomUUID();
  const order = { ...body, id };
  seededOrders.set(id, order);
  inbox.push({
    id: randomUUID(),
    shopId: 'stub-shop',
    created: new Date().toISOString(),
    read: false,
    type: 'orderCreated',
    payload: { id, externalOrderId: id },
  });
  sendJson(res, 201, { id });
}

function handleStubConfig(req, res) {
  if (req.method === 'PUT') {
    return readBody(req).then((raw) => {
      let parsed;
      try {
        parsed = JSON.parse(raw || '{}');
      } catch {
        return sendJson(res, 400, { error: 'invalid JSON body' });
      }
      if (typeof parsed.latencyMs === 'number' && Number.isFinite(parsed.latencyMs) && parsed.latencyMs >= 0) {
        LATENCY_MS = parsed.latencyMs;
      }
      return sendJson(res, 200, describeConfig());
    });
  }
  return sendJson(res, 200, describeConfig());
}

function describeConfig() {
  return {
    gitSha: GIT_SHA,
    latencyMs: LATENCY_MS,
    requestsTotal,
    quantityWritesTotal,
    ordersServedTotal,
    inboxDepth: inbox.length,
  };
}

function handleStubReset(res) {
  inbox = [];
  seededOrders.clear();
  quantityWritesTotal = 0;
  ordersServedTotal = 0;
  requestsTotal = 0;
  sendJson(res, 200, describeConfig());
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/__stub/health') {
    return sendJson(res, 200, { ok: true });
  }
  if (url.pathname === '/__stub/config') {
    return void handleStubConfig(req, res);
  }
  if (url.pathname === '/__stub/reset' && req.method === 'POST') {
    return handleStubReset(res);
  }
  if (url.pathname === '/__stub/seed-order' && req.method === 'POST') {
    return void handleSeedOrder(req, res);
  }
  if (url.pathname === '/me' && req.method === 'GET') {
    return void handleMe(res);
  }
  if (url.pathname === '/inbox' && req.method === 'GET') {
    return void handleInbox(res);
  }
  if (url.pathname === '/inbox/mark-read' && req.method === 'POST') {
    return void handleMarkRead(req, res);
  }
  const orderMatch = /^\/orders\/([^/]+)$/.exec(url.pathname);
  if (orderMatch && req.method === 'GET') {
    return void handleGetOrder(decodeURIComponent(orderMatch[1]), res);
  }
  const productMatch = /^\/products\/([^/]+)$/.exec(url.pathname);
  if (productMatch && req.method === 'GET') {
    return void handleGetProduct(decodeURIComponent(productMatch[1]), res);
  }
  if (productMatch && req.method === 'PATCH') {
    return void handlePatchProduct(req, res);
  }

  sendJson(res, 404, { message: 'not found' });
});

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  server.listen(PORT, () => {
    // eslint-disable-next-line no-console -- standalone script, no Logger available
    console.log(`erli-stub listening on :${PORT} (gitSha=${GIT_SHA})`);
  });
}

function _resetForTest() {
  inbox = [];
  seededOrders.clear();
  quantityWritesTotal = 0;
  ordersServedTotal = 0;
  requestsTotal = 0;
  LATENCY_MS = 0;
}

export { server, describeConfig, _resetForTest };
