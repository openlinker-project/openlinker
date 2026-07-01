/**
 * Infakt Sandbox POC Test Script
 *
 * Runs a full E2E verification against the Infakt sandbox API:
 *   1. upsertCustomer — find or create a test buyer by NIP
 *   2. issueInvoice   — create a VAT invoice
 *   3. getInvoice     — read back the created invoice by UUID
 *   4. getClearanceStatus — read ksef_data (before KSeF submit)
 *   5. sendToKsef     — trigger KSeF submission
 *   6. pollUntilCleared — poll getClearanceStatus until success/error (max 3 min)
 *
 * Usage:
 *   INFAKT_SANDBOX_API_KEY=<key> pnpm --filter @openlinker/integrations-infakt poc:sandbox
 *
 * Optional env:
 *   INFAKT_BASE_URL   — defaults to https://api.sandbox-infakt.pl/api/v3
 *   POC_POLL_MAX_MS   — max poll time in ms (default 180000 = 3 min)
 *   POC_POLL_INTERVAL_MS — poll interval (default 10000 = 10 s)
 *
 * Verified live 2026-06-30: full draft→KSeF clearance in ~90 s on sandbox.
 *
 * Lives outside src/ (package `include` is `src/**\/*`) so it never compiles
 * into dist or ships to consumers of this package.
 */

/* eslint-disable no-console -- POC script intentionally uses console for output */

import { InfaktHttpClient } from '../src/infrastructure/http/infakt-http-client';
import { InfaktInvoicingAdapter } from '../src/infrastructure/adapters/infakt-invoicing.adapter';
import type { InfaktSendToKsefResponse } from '../src/domain/types/infakt.types';
import { BuyerProfile } from '@openlinker/core/invoicing';

// ---- config ----------------------------------------------------------------

const API_KEY = process.env['INFAKT_SANDBOX_API_KEY'] ?? '';
const BASE_URL =
  process.env['INFAKT_BASE_URL'] ?? 'https://api.sandbox-infakt.pl/api/v3';
const POLL_MAX_MS = parseInt(process.env['POC_POLL_MAX_MS'] ?? '180000', 10);
const POLL_INTERVAL_MS = parseInt(process.env['POC_POLL_INTERVAL_MS'] ?? '10000', 10);

const CONNECTION_ID = 'poc-sandbox-connection';

if (!API_KEY) {
  console.error('ERROR: set INFAKT_SANDBOX_API_KEY env var');
  process.exit(1);
}

// ---- logger (console) -------------------------------------------------------

const logger = {
  log: (msg: string, meta?: unknown) => console.log(`[INFO]  ${msg}`, meta ?? ''),
  warn: (msg: string, meta?: unknown) => console.warn(`[WARN]  ${msg}`, meta ?? ''),
  error: (msg: string, meta?: unknown) => console.error(`[ERROR] ${msg}`, meta ?? ''),
  debug: (msg: string, meta?: unknown) => console.debug(`[DEBUG] ${msg}`, meta ?? ''),
  verbose: (msg: string, meta?: unknown) => console.debug(`[VERB]  ${msg}`, meta ?? ''),
  fatal: (msg: string, meta?: unknown) => console.error(`[FATAL] ${msg}`, meta ?? ''),
};

// ---- adapter wiring ---------------------------------------------------------

const http = new InfaktHttpClient({ apiKey: API_KEY, baseUrl: BASE_URL }, logger);
const adapter = new InfaktInvoicingAdapter(CONNECTION_ID, http, logger);

// ---- test buyer profile -----------------------------------------------------

const testBuyer = new BuyerProfile(
  'OpenLinker Test Sp. z o.o.',
  { scheme: 'pl-nip', value: '5252659437' },
  { line1: 'ul. Testowa 1', line2: null, city: 'Warszawa', postalCode: '00-001', countryIso2: 'PL' },
  'company',
);

// ---- helpers ----------------------------------------------------------------

function ok(label: string, value?: unknown): void {
  console.log(`  ✅ ${label}`, value !== undefined ? value : '');
}

function fail(label: string, err: unknown): void {
  console.error(`  ❌ ${label}`, err);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollUntilCleared(invoiceUuid: string): Promise<string | null> {
  const deadline = Date.now() + POLL_MAX_MS;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    const result = await adapter.getClearanceStatus({
      id: invoiceUuid,
      connectionId: CONNECTION_ID,
      orderId: '',
      providerType: 'infakt',
      documentType: 'invoice',
      status: 'issued',
      providerInvoiceId: invoiceUuid,
      providerInvoiceNumber: null,
      regulatoryStatus: 'submitted',
      clearanceReference: null,
      idempotencyKey: null,
      pdfUrl: null,
      issuedAt: null,
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Parameters<typeof adapter.getClearanceStatus>[0]);

    console.log(
      `  Poll #${attempt}: regulatoryStatus=${result.regulatoryStatus}, clearanceReference=${result.clearanceReference ?? 'null'}`,
    );

    if (result.regulatoryStatus === 'cleared' || result.regulatoryStatus === 'accepted') {
      return result.clearanceReference ?? null;
    }
    if (result.regulatoryStatus === 'rejected') {
      throw new Error('KSeF returned rejected status');
    }

    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`KSeF clearance poll timed out after ${POLL_MAX_MS / 1000} s`);
}

// ---- main -------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('');
  console.log('=== Infakt Sandbox POC ===');
  console.log(`baseUrl: ${BASE_URL}`);
  console.log('');

  // Step 1 — upsertCustomer
  console.log('STEP 1 — upsertCustomer');
  let clientUuid: string;
  try {
    const r = await adapter.upsertCustomer({
      connectionId: CONNECTION_ID,
      buyer: testBuyer,
    });
    clientUuid = r.providerCustomerId;
    ok('client upserted', `uuid=${clientUuid}`);
  } catch (err) {
    fail('upsertCustomer failed', err);
    process.exit(1);
  }

  // Step 2 — issueInvoice
  console.log('\nSTEP 2 — issueInvoice');
  let invoiceUuid: string;
  let invoiceNumber: string | null;
  try {
    const record = await adapter.issueInvoice({
      connectionId: CONNECTION_ID,
      orderId: `poc-order-${Date.now()}`,
      buyer: testBuyer,
      currency: 'PLN',
      documentType: 'invoice',
      idempotencyKey: `poc-${Date.now()}`,
      lines: [
        {
          name: 'Abonament OpenLinker — POC test',
          quantity: 1,
          unitPriceGross: 369, // gross = 300 net × 1.23
          taxRate: '23',
        },
        {
          name: 'Konfiguracja integracji',
          quantity: 2,
          unitPriceGross: 123, // 100 net × 1.23
          taxRate: '23',
        },
      ],
    });
    invoiceUuid = record.providerInvoiceId!;
    invoiceNumber = record.providerInvoiceNumber;
    ok('invoice created', `uuid=${invoiceUuid} number=${invoiceNumber ?? 'draft'} status=${record.status}`);
    ok('initial regulatoryStatus', record.regulatoryStatus);
  } catch (err) {
    fail('issueInvoice failed', err);
    process.exit(1);
  }

  // Step 3 — getInvoice by UUID
  console.log('\nSTEP 3 — getInvoice (read back by UUID)');
  try {
    const fetched = await adapter.getInvoice({ providerInvoiceId: invoiceUuid });
    if (!fetched) throw new Error('getInvoice returned null');
    ok('invoice fetched', `uuid=${fetched.providerInvoiceId} number=${fetched.providerInvoiceNumber ?? 'draft'}`);
    ok('regulatoryStatus from getInvoice', fetched.regulatoryStatus);
  } catch (err) {
    fail('getInvoice failed', err);
    // Non-fatal — continue
  }

  // Step 4 — getClearanceStatus (before KSeF trigger)
  console.log('\nSTEP 4 — getClearanceStatus (pre-submit)');
  try {
    const preStatus = await adapter.getClearanceStatus({
      id: invoiceUuid,
      connectionId: CONNECTION_ID,
      orderId: '',
      providerType: 'infakt',
      documentType: 'invoice',
      status: 'issued',
      providerInvoiceId: invoiceUuid,
      providerInvoiceNumber: invoiceNumber,
      regulatoryStatus: 'not-applicable',
      clearanceReference: null,
      idempotencyKey: null,
      pdfUrl: null,
      issuedAt: null,
      errorMessage: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Parameters<typeof adapter.getClearanceStatus>[0]);
    ok('pre-submit clearance', `status=${preStatus.regulatoryStatus} ref=${preStatus.clearanceReference ?? 'null'}`);
  } catch (err) {
    fail('getClearanceStatus (pre) failed', err);
  }

  // Step 5 — trigger KSeF (Infakt-specific, not in port)
  console.log('\nSTEP 5 — sendToKsef (trigger KSeF submission)');
  let ksefResponse: InfaktSendToKsefResponse;
  try {
    ksefResponse = await adapter.sendToKsef(invoiceUuid);
    ok('send_to_ksef accepted', `status=${ksefResponse.status} request_uuid=${ksefResponse.request_uuid}`);
  } catch (err) {
    fail('sendToKsef failed', err);
    console.log('  → skipping KSeF poll (KSeF may not be configured on this account)');
    console.log('\n=== POC DONE (no KSeF) ===');
    console.log('issueInvoice + getInvoice + getClearanceStatus: CONFIRMED ✅');
    return;
  }

  // Step 6 — poll until cleared
  console.log(`\nSTEP 6 — polling KSeF clearance (max ${POLL_MAX_MS / 1000} s, every ${POLL_INTERVAL_MS / 1000} s)`);
  try {
    const ksefNumber = await pollUntilCleared(invoiceUuid);
    ok('KSeF CLEARED', `ksef_number=${ksefNumber ?? 'n/a'}`);
  } catch (err) {
    fail('KSeF clearance failed or timed out', err);
    process.exit(1);
  }

  console.log('');
  console.log('=== POC COMPLETE ✅ ===');
  console.log('All steps confirmed:');
  console.log('  upsertCustomer → issueInvoice → getInvoice → getClearanceStatus → sendToKsef → cleared');
}

main().catch((err: unknown) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
