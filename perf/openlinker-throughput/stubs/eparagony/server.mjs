#!/usr/bin/env node
'use strict';

/**
 * eparagony.pl upstream stub - #3043 (F14, epic #2840).
 *
 * A single-process `node:http` stub in the shape of `stubs/invoicing/server.mjs`
 * (#3006) and `stubs/allegro/server.mjs` (#2856), serving just enough of the
 * eparagony.pl Documents REST API v3 for OpenLinker's REAL, unmodified
 * `EparagonyFiscalizationAdapter` to run against it - so the load-bearing
 * behaviours the real adapter owns (the bounded status poll, the
 * document-already-exists idempotent replay, the terminal ERROR -> rejected
 * classification, an unbounded poll -> in-doubt classification) are exercised
 * by REAL adapter code, not reimplemented here. The stub's only job is to
 * decide the TIMING and OUTCOME of that poll, per `/__stub/config`.
 *
 * Two hosts collapse into one process here (`apiBaseUrl` and `authBaseUrl`
 * both resolve to this same stub in the lab connection's config) - the real
 * vendor splits auth (`login[.sandbox].eparagony.pl`) from the documents API
 * (`api[.sandbox].eparagony.pl`), but nothing in `EparagonyHttpClient`
 * requires them to be different hosts, and splitting them here would need a
 * second TLS-terminated container for no measurement benefit.
 *
 * TLS: `EparagonyHttpClient` requires https on BOTH hosts (`originOf` throws
 * on a non-https base URL) - this process itself speaks plain HTTP on
 * `STUB_PORT`; `docker-compose.lab.yml` fronts it with an nginx TLS
 * terminator (`stand/lab-tls/`), the `wc-tls` precedent (#2854).
 *
 * WHAT THIS DOES NOT MEASURE: a real device's variance, the vendor's actual
 * rate limits, or every documented `errorCode`. `forceOutcome` and
 * `pollsUntilConfirmed` are OpenLinker's own knobs for producing the three
 * outcomes core's fiscal-registration lock cares about (confirmed / rejected
 * / in-doubt) on demand - never a claim about what the real device does.
 */

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { URL, fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Config (env at boot; every knob is ALSO runtime-mutable via
// PUT /__stub/config, mirroring stubs/invoicing's "no container recreate
// between arms" rationale).
// ---------------------------------------------------------------------------
const PORT = Number(process.env.STUB_PORT || 19084);
const GIT_SHA = process.env.STUB_GIT_SHA || 'unknown';

let LATENCY_MS = Number(process.env.STUB_LATENCY_MS || 0);
// How many status reads return READY before the outcome below applies. A
// freshly-created document is always READY on read #0 - this is the number
// of ADDITIONAL reads that stay READY, so `pollsUntilConfirmed: 0` confirms
// on the very first status read.
let POLLS_UNTIL_OUTCOME = Number(process.env.STUB_POLLS_UNTIL_OUTCOME ?? 1);
// 'confirmed' | 'error' | 'hang' - applied to a document at CREATE time (a
// mid-flight knob change never rewrites an in-flight document's fate, same
// as invoicing-stub's latency-survives-reset rule), so a sweep sets this
// before enqueuing the arm's jobs, not while they are running.
let FORCE_OUTCOME = process.env.STUB_FORCE_OUTCOME || 'confirmed';

// ---------------------------------------------------------------------------
// State - in-memory, per-process, reset by POST /__stub/reset. Keyed by the
// vendor path token (`documentToken`), which `EparagonyFiscalizationAdapter`
// derives deterministically from (connectionId, idempotencyKey) - so a
// retried create under the SAME key is genuinely idempotent here too.
// ---------------------------------------------------------------------------
const documents = new Map();
let requestsTotal = 0;
let createCount = 0;
let confirmedCount = 0;
let errorCount = 0;
let tokenRequestsTotal = 0;

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

// POST /auth/token - OAuth2 client_credentials. Accepts any client_id/secret
// (this is a lab stub with nothing to authenticate against) so the real
// adapter's token-cache/refresh logic runs unmodified.
async function handleAuthToken(req, res) {
  tokenRequestsTotal += 1;
  await readBody(req); // read + discard, same "behave like a real round-trip" reasoning as stubs/invoicing
  await sleep(LATENCY_MS);
  sendJson(res, 200, {
    access_token: `stub-access-token-${randomUUID()}`,
    token_type: 'Bearer',
    expires_in: 3600,
    scope: 'document_create printer_get ecommerce',
  });
}

// POST /documents - create (or idempotently replay) a fiscal document.
// Real vendor: `Idempotency-Key` header carries the caller's documentToken.
async function handleCreateDocument(req, res) {
  requestsTotal += 1;
  const raw = await readBody(req);
  let body;
  try {
    body = JSON.parse(raw || '{}');
  } catch {
    return sendJson(res, 400, { errorCode: 999, errorDescription: 'invalid JSON body' });
  }
  const token = req.headers['idempotency-key'];
  if (!token || typeof token !== 'string') {
    return sendJson(res, 400, {
      errorCode: 998,
      errorDescription: 'missing Idempotency-Key header',
    });
  }

  await sleep(LATENCY_MS);

  const existing = documents.get(token);
  if (existing) {
    // Real vendor: a repeat create under an already-used token answers
    // errorCode 118 (DOCUMENT_ALREADY_EXISTS) - the adapter's own
    // `createDocument` reads this specific code as "our earlier attempt
    // landed" and proceeds straight to the status read.
    return sendJson(res, 409, {
      errorCode: 118,
      errorDescription: 'document already exists under this token',
    });
  }

  createCount += 1;
  documents.set(token, {
    transactionToken: typeof body.transactionToken === 'string' ? body.transactionToken : token,
    documentToken: token,
    outcome: FORCE_OUTCOME,
    pollsUntilOutcome: POLLS_UNTIL_OUTCOME,
    pollCount: 0,
    orderId: body?.eReceipt?.metadata?.orderId ?? null,
    createdAt: Date.now(),
  });

  sendJson(res, 202, {
    transactionToken: body.transactionToken ?? token,
    documentToken: token,
    documentPublicUrl: null,
    documentStatusUrl: `/documents/${token}/status`,
  });
}

// GET /documents/:token/status
async function handleGetStatus(token, res) {
  requestsTotal += 1;
  const doc = documents.get(token);
  await sleep(LATENCY_MS);

  if (!doc) {
    // errorCode 92 - UNKNOWN_DOCUMENT_TOKEN, one of the two codes the real
    // adapter reads as "no document under this token" (readStatus's
    // `treatUnknownDocumentAsMissing` branch).
    return sendJson(res, 404, { errorCode: 92, errorDescription: 'unknown document token' });
  }

  doc.pollCount += 1;

  if (doc.outcome === 'hang') {
    // Never reaches a terminal status - exercises the real adapter's
    // poll-budget-exhausted path, which throws (never a rejection) and is
    // exactly the in-doubt outcome #3044 needs to produce on demand.
    return sendJson(res, 200, {
      status: 'READY',
      documentToken: token,
      transactionToken: doc.transactionToken,
    });
  }

  if (doc.pollCount <= doc.pollsUntilOutcome) {
    return sendJson(res, 200, {
      status: 'READY',
      documentToken: token,
      transactionToken: doc.transactionToken,
    });
  }

  if (doc.outcome === 'error') {
    errorCount += 1;
    return sendJson(res, 200, {
      status: 'ERROR',
      documentToken: token,
      transactionToken: doc.transactionToken,
      errorCode: 501,
      errorDescription: 'stub-forced fiscal device error',
    });
  }

  confirmedCount += 1;
  return sendJson(res, 200, {
    status: 'CONFIRMED',
    documentToken: token,
    transactionToken: doc.transactionToken,
    fiscalDocumentId: `stub-fdi-${token.slice(0, 8)}`,
    fiscalDeviceUniqueNumber: 'STUB0000000001',
    fiscalDocumentNumber: String(confirmedCount),
    receiptNumber: String(confirmedCount),
    orderId: doc.orderId,
    documentUrl: `https://stub.invalid/documents/${token}`,
    printed: false,
    endTime: new Date().toISOString(),
  });
}

// GET /printers/:id/status - the connection-tester diagnostic (`printer_get`
// scope). Always reports the one stub device as online.
async function handlePrinterStatus(res) {
  await sleep(LATENCY_MS);
  sendJson(res, 200, { status: 'online', lastActiveAt: new Date().toISOString(), crkStatus: 'ok' });
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
      if (
        typeof parsed.pollsUntilOutcome === 'number' &&
        Number.isFinite(parsed.pollsUntilOutcome) &&
        parsed.pollsUntilOutcome >= 0
      ) {
        POLLS_UNTIL_OUTCOME = parsed.pollsUntilOutcome;
      }
      if (['confirmed', 'error', 'hang'].includes(parsed.forceOutcome)) {
        FORCE_OUTCOME = parsed.forceOutcome;
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
    pollsUntilOutcome: POLLS_UNTIL_OUTCOME,
    forceOutcome: FORCE_OUTCOME,
    requestsTotal,
    tokenRequestsTotal,
    createCount,
    confirmedCount,
    errorCount,
    documentsHeld: documents.size,
  };
}

function handleStubReset(res) {
  // latencyMs / pollsUntilOutcome / forceOutcome are the arm's independent
  // variables and DELIBERATELY survive a reset, same as invoicing-stub's
  // latency.
  documents.clear();
  requestsTotal = 0;
  tokenRequestsTotal = 0;
  createCount = 0;
  confirmedCount = 0;
  errorCount = 0;
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
  if (url.pathname === '/auth/token' && req.method === 'POST') {
    return void handleAuthToken(req, res);
  }
  if (url.pathname === '/documents' && req.method === 'POST') {
    return void handleCreateDocument(req, res);
  }
  const statusMatch = /^\/documents\/([^/]+)\/status$/.exec(url.pathname);
  if (statusMatch && req.method === 'GET') {
    return void handleGetStatus(decodeURIComponent(statusMatch[1]), res);
  }
  const printerMatch = /^\/printers\/([^/]+)\/status$/.exec(url.pathname);
  if (printerMatch && req.method === 'GET') {
    return void handlePrinterStatus(res);
  }

  sendJson(res, 404, { errorCode: 100, errorDescription: 'not found' });
});

// Only auto-listen when run directly - test.mjs imports and listens(0) itself.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  server.listen(PORT, () => {
    // eslint-disable-next-line no-console -- standalone script, no Logger available
    console.log(`eparagony-stub listening on :${PORT} (gitSha=${GIT_SHA})`);
  });
}

function _resetForTest() {
  documents.clear();
  requestsTotal = 0;
  tokenRequestsTotal = 0;
  createCount = 0;
  confirmedCount = 0;
  errorCount = 0;
  LATENCY_MS = 0;
  POLLS_UNTIL_OUTCOME = 1;
  FORCE_OUTCOME = 'confirmed';
}

export { server, describeConfig, _resetForTest };
