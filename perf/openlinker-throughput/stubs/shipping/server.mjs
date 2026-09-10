#!/usr/bin/env node
'use strict';

/**
 * Carrier upstream stub - #3043 (provisioning for F15 / #3045, epic #2840).
 *
 * A single-process `node:http` stub in the shape of `stubs/invoicing/
 * server.mjs` (#3006), serving `ShippingStubShippingAdapter`
 * (`@openlinker/integrations-shipping-stub`) - a REAL, dedicated
 * `ShippingProviderManagerPort` adapter built for this stub because neither
 * in-tree carrier adapter (InPost, DPD Polska) supports a base-URL override
 * (see the package README).
 *
 * The one behaviour this stub exists to control on demand is the InPost/
 * ShipX shape #1947 was written for: a carrier that mints the tracking
 * number AFTER label confirmation, not synchronously with it. That is what
 * exercises core's `Shipment.trackingNumber` `null -> value` backfill path
 * (`ShipmentStatusSyncService`) and its at-most-once relay claim
 * (`waybillRelayedAt`) - the label-generation happy path alone never
 * reaches either.
 */

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { URL, fileURLToPath } from 'node:url';

const PORT = Number(process.env.STUB_PORT || 19086);
const GIT_SHA = process.env.STUB_GIT_SHA || 'unknown';
let LATENCY_MS = Number(process.env.STUB_LATENCY_MS || 0);
// When true (default), `POST /labels` returns a tracking number synchronously
// (the "happy path" a real courier sometimes offers). When false, tracking
// stays null until `pollsUntilTracking` GET /shipments/:id/tracking reads
// have happened - the late-mint shape #3045 needs.
let MINT_TRACKING_IMMEDIATELY = process.env.STUB_MINT_TRACKING_IMMEDIATELY !== 'false';
let POLLS_UNTIL_TRACKING = Number(process.env.STUB_POLLS_UNTIL_TRACKING ?? 2);

const shipments = new Map();
let labelsIssuedTotal = 0;
let trackingReadsTotal = 0;
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

// POST /labels - GenerateLabelCommand -> GenerateLabelResult.
async function handleGenerateLabel(req, res) {
  requestsTotal += 1;
  await readBody(req);
  await sleep(LATENCY_MS);

  const providerShipmentId = `stub-shp-${randomUUID()}`;
  const mintNow = MINT_TRACKING_IMMEDIATELY;
  const trackingNumber = mintNow ? `STUB-TRACK-${labelsIssuedTotal + 1}` : null;

  labelsIssuedTotal += 1;
  shipments.set(providerShipmentId, {
    trackingNumber,
    pollsUntilTracking: POLLS_UNTIL_TRACKING,
    pollCount: 0,
    createdAt: Date.now(),
  });

  sendJson(res, 201, {
    providerShipmentId,
    trackingNumber,
    labelPdfRef: `https://stub.invalid/labels/${providerShipmentId}.pdf`,
  });
}

// GET /shipments/:id/tracking - TrackingSnapshot.
async function handleGetTracking(providerShipmentId, res) {
  requestsTotal += 1;
  trackingReadsTotal += 1;
  await sleep(LATENCY_MS);

  const shipment = shipments.get(providerShipmentId);
  if (!shipment) {
    return sendJson(res, 404, { message: 'unknown providerShipmentId' });
  }

  shipment.pollCount += 1;
  if (shipment.trackingNumber === null && shipment.pollCount >= shipment.pollsUntilTracking) {
    // Late mint - the confirmation-then-tracking-later shape.
    shipment.trackingNumber = `STUB-TRACK-LATE-${providerShipmentId.slice(-6)}`;
  }

  sendJson(res, 200, {
    status: shipment.trackingNumber === null ? 'generated' : 'dispatched',
    trackingNumber: shipment.trackingNumber,
    carrier: 'inpost',
    providerStatus: shipment.trackingNumber === null ? 'label-issued' : 'sent',
  });
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
      if (typeof parsed.mintTrackingImmediately === 'boolean') {
        MINT_TRACKING_IMMEDIATELY = parsed.mintTrackingImmediately;
      }
      if (
        typeof parsed.pollsUntilTracking === 'number' &&
        Number.isFinite(parsed.pollsUntilTracking) &&
        parsed.pollsUntilTracking >= 0
      ) {
        POLLS_UNTIL_TRACKING = parsed.pollsUntilTracking;
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
    mintTrackingImmediately: MINT_TRACKING_IMMEDIATELY,
    pollsUntilTracking: POLLS_UNTIL_TRACKING,
    requestsTotal,
    labelsIssuedTotal,
    trackingReadsTotal,
    shipmentsHeld: shipments.size,
  };
}

function handleStubReset(res) {
  // Knobs (latencyMs / mintTrackingImmediately / pollsUntilTracking) are the
  // arm's independent variables and DELIBERATELY survive a reset.
  shipments.clear();
  labelsIssuedTotal = 0;
  trackingReadsTotal = 0;
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
  if (url.pathname === '/labels' && req.method === 'POST') {
    return void handleGenerateLabel(req, res);
  }
  const trackingMatch = /^\/shipments\/([^/]+)\/tracking$/.exec(url.pathname);
  if (trackingMatch && req.method === 'GET') {
    return void handleGetTracking(decodeURIComponent(trackingMatch[1]), res);
  }

  sendJson(res, 404, { message: 'not found' });
});

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  server.listen(PORT, () => {
    // eslint-disable-next-line no-console -- standalone script, no Logger available
    console.log(`shipping-stub listening on :${PORT} (gitSha=${GIT_SHA})`);
  });
}

function _resetForTest() {
  shipments.clear();
  labelsIssuedTotal = 0;
  trackingReadsTotal = 0;
  requestsTotal = 0;
  LATENCY_MS = 0;
  MINT_TRACKING_IMMEDIATELY = true;
  POLLS_UNTIL_TRACKING = 2;
}

export { server, describeConfig, _resetForTest };
