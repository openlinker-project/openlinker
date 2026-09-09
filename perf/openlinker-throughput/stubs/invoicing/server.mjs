#!/usr/bin/env node
'use strict';

/**
 * Invoicing-provider stub - #3006.
 *
 * A fixed/configurable-latency fake destination standing in for a real
 * invoicing provider, in the shape of `stubs/allegro/server.mjs` (#2856).
 * It serves exactly ONE endpoint on the path OpenLinker's `invoicing.issue`
 * job actually exercises: `POST /invoices`, called by
 * `InvoicingStubInvoicingAdapter.issueInvoice` (the real, unmodified core
 * `InvoiceService.issueInvoice()` -> per-order lock -> adapter call chain -
 * nothing about the measurement is a fake job handler; only the network
 * boundary answers instantly-but-delayed instead of a real authority).
 *
 * This file is standalone node:http with zero dependencies, deliberately -
 * see stubs/allegro/server.mjs's header for why `perf/` cannot be a pnpm
 * workspace member without editing pnpm-workspace.yaml.
 *
 * WHAT THIS DOES NOT MEASURE (state this everywhere the numbers are quoted):
 * a real provider's own variance, its rate limits, or its failure modes. The
 * ONLY thing this stub's latency represents is "the provider takes T seconds
 * to answer" - a single constant, never a distribution, chosen from this
 * repository's own inFakt/KSeF end-to-end confirmation (~90s) down to an
 * optimistic 2s. See #3006 and `results-fiscal-lane-<date>.md`.
 */

import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { URL, fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Config (env at boot; latency is ALSO runtime-mutable via PUT /__stub/config
// so a latency sweep does not need a container recreate between arms - see
// README "Why latency is mutable at runtime").
// ---------------------------------------------------------------------------
const PORT = Number(process.env.STUB_PORT || 19082);
let LATENCY_MS = Number(process.env.STUB_LATENCY_MS || 0);
const GIT_SHA = process.env.STUB_GIT_SHA || 'unknown';

// ---------------------------------------------------------------------------
// State - deliberately IN-MEMORY and per-process. Reset by POST
// /__stub/reset between arms (never restarted), so per-arm counters cannot
// leak from one measurement window into the next.
// ---------------------------------------------------------------------------
let requestsTotal = 0;
let inFlight = 0;
let maxInFlightObserved = 0;
let issuedCount = 0;

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
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

// POST /invoices - the one call InvoicingStubInvoicingAdapter.issueInvoice
// makes. Always succeeds (this stub has no concept of a genuinely invalid
// document to reject - the "mock is now the model" trap #2840 names by
// name); its ONLY job is to hold the connection open for LATENCY_MS while
// tracking in-flight concurrency, which is the measurement this scenario is
// built to observe.
async function handleIssueInvoice(req, res) {
  requestsTotal += 1;
  inFlight += 1;
  if (inFlight > maxInFlightObserved) maxInFlightObserved = inFlight;
  try {
    // The request body is read (and discarded past a size sanity check) so
    // the connection behaves like a real HTTP round-trip rather than
    // ignoring the payload outright - but nothing about the response
    // depends on its contents; this stub has no per-order state.
    await readBody(req);
    await sleep(LATENCY_MS);
    issuedCount += 1;
    const n = issuedCount;
    sendJson(res, 201, {
      id: `stub-inv-${n}-${randomBytes(4).toString('hex')}`,
      number: `STUB/${n}`,
      status: 'issued',
      issuedAt: new Date().toISOString(),
    });
  } finally {
    inFlight -= 1;
  }
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
    issuedCount,
    inFlight,
    maxInFlightObserved,
  };
}

function handleStubReset(res) {
  // Latency is DELIBERATELY untouched by a reset - it is the arm's
  // independent variable, set once via PUT /__stub/config and read across
  // every reset the sweep performs inside that arm.
  requestsTotal = 0;
  issuedCount = 0;
  maxInFlightObserved = inFlight; // in-flight requests, if any, survive a reset honestly
  sendJson(res, 200, describeConfig());
}

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/__stub/health') {
    return sendJson(res, 200, { ok: true });
  }
  if (url.pathname === '/__stub/config') {
    return handleStubConfig(req, res);
  }
  if (url.pathname === '/__stub/reset' && req.method === 'POST') {
    return handleStubReset(res);
  }
  if (url.pathname === '/invoices' && req.method === 'POST') {
    return void handleIssueInvoice(req, res);
  }

  sendJson(res, 404, { error: 'not found' });
});

// Only auto-listen when this file is run directly (`node server.mjs`), never
// on import - test.mjs imports this module and calls server.listen(0) itself
// so it gets an ephemeral port instead of colliding with a real instance on
// PORT (the stubs/allegro/server.mjs precedent).
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  server.listen(PORT, () => {
    // eslint-disable-next-line no-console -- standalone script, no Logger available
    console.log(`invoicing-stub listening on :${PORT} (gitSha=${GIT_SHA}, latencyMs=${LATENCY_MS})`);
  });
}

// Exported for test.mjs (in-process ephemeral-port testing) and so a test can
// reset counters/latency between cases without a real HTTP round-trip.
function _resetForTest() {
  requestsTotal = 0;
  inFlight = 0;
  maxInFlightObserved = 0;
  issuedCount = 0;
  LATENCY_MS = 0;
}

export { server, describeConfig, _resetForTest };
