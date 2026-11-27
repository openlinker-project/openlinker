/**
 * Batch issuing golden-path seed (#3585)
 *
 * One dual-role e-paragony connection that issues RECEIPTS at once
 * (`auto-on-paid`) and INVOICES in batches, and three paid PL orders:
 *
 * - `b2b`        - buyer has a tax id; routing gives it an invoice, so it
 *                  waits in the connection's batch queue.
 * - `b2c`        - no tax id; routing gives it a receipt, issued at once, so
 *                  it never enters the queue.
 * - `documented` - B2B and queued, but it already holds an issued invoice on
 *                  ANOTHER connection; a run must not issue a second one.
 *
 * Written straight into Postgres, the same deliberate exception the other
 * `sales-document-*-seed.ts` modules document: a connection's
 * `enabledCapabilities` has no HTTP write path, and an order cannot be
 * ingested without a live source. The queue rows are exactly what the
 * auto-issue gate persists for a paid order on a batched kind (#3583:
 * `trigger-model-batched` + target connection + kind), and the snapshots are
 * complete enough for a run to rebuild each order and ask the gate again.
 *
 * The routing rules (B2B -> invoice, B2C -> receipt) are created through the
 * API by the spec, not here, because a rule's identity hash is computed
 * server-side.
 *
 * Idempotent: fixed ids, and every row this seed owns is cleared first.
 *
 * @module support
 */
import pg from 'pg';
import { resolveEnv } from '../config/env';
import { assertSeedableDatabase } from './assert-seedable-database';

export const G10_CONNECTION_ID = '66666666-6666-4666-8666-666666666601';
export const G10_CONNECTION_NAME = 'e-paragony (G10 batch seed)';
/** Holds the invoice the `documented` order already has. */
export const G10_OTHER_CONNECTION_ID = '66666666-6666-4666-8666-666666666602';
const G10_SOURCE_CONNECTION_ID = '66666666-6666-4666-8666-666666666603';

export const G10_ORDER_IDS = {
  b2b: 'ol_order_g10seed0001b2bqueued0000',
  b2c: 'ol_order_g10seed0002b2creceipt000',
  documented: 'ol_order_g10seed0003documented000',
} as const;

export const G10_BUYER_TAX_ID = '5260250274';

function snapshot(
  orderId: string,
  orderNumber: string,
  buyer: string,
  taxId: string | null
): string {
  const [firstName, lastName] = buyer.split(' ');
  const address = {
    firstName,
    lastName,
    address1: 'ul. Prosta 1',
    city: 'Warszawa',
    postalCode: '00-001',
    country: 'PL',
    ...(taxId === null ? {} : { company: 'Firma Testowa', taxId }),
  };
  return JSON.stringify({
    id: orderId,
    orderNumber,
    status: 'processing',
    paymentStatus: 'paid',
    customerEmail: 'g10@example.com',
    placedAt: '2026-09-24T19:40:00.000Z',
    billingAddress: address,
    shippingAddress: address,
    items: [
      {
        id: `${orderId}-line-1`,
        productId: 'ol_product_g10seed',
        quantity: 1,
        price: 123,
        name: 'Kubek ceramiczny',
        sku: 'G10-MUG',
        taxRate: '23',
        taxRateCountry: 'PL',
      },
    ],
    totals: {
      subtotal: 123,
      tax: 23,
      shipping: 0,
      total: 123,
      currency: 'PLN',
      taxTreatment: 'inclusive',
    },
  });
}

export async function seedBatchGoldenPath(): Promise<void> {
  assertSeedableDatabase('seedBatchGoldenPath');
  const env = resolveEnv();
  const client = new pg.Client({ connectionString: env.databaseUrl });
  await client.connect();
  const orderIds = Object.values(G10_ORDER_IDS);
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM invoice_records WHERE "orderId" = ANY($1::text[])`, [orderIds]);
    await client.query(
      `DELETE FROM fiscal_registration_records WHERE "orderId" = ANY($1::text[])`,
      [orderIds]
    );
    await client.query(`DELETE FROM sync_jobs WHERE "payloadJson"->>'orderId' = ANY($1::text[])`, [
      orderIds,
    ]);
    await client.query(
      `DELETE FROM sales_document_batch_run_items WHERE "runId" IN
         (SELECT id FROM sales_document_batch_runs WHERE "connectionId" = $1)`,
      [G10_CONNECTION_ID]
    );
    await client.query(`DELETE FROM sales_document_batch_runs WHERE "connectionId" = $1`, [
      G10_CONNECTION_ID,
    ]);
    await client.query(`DELETE FROM order_records WHERE "internalOrderId" = ANY($1::text[])`, [
      orderIds,
    ]);

    const config = {
      salesDocument: {
        documentKind: 'both',
        triggerModels: { invoice: 'batched', 'fiscal-receipt': 'auto-on-paid' },
        // A month-end schedule whose next slot is weeks away: nothing runs on
        // its own during the spec, so the only run is the one "Run now" starts.
        batchSchedules: {
          invoice: {
            frequency: 'month-end',
            timeZone: 'Europe/Warsaw',
            effectiveFrom: new Date().toISOString(),
          },
        },
      },
    };
    await client.query(
      `INSERT INTO connections
         (id, "platformType", name, status, config, "credentialsRef", "enabledCapabilities", "adapterKey")
       VALUES ($1, 'eparagony', $2, 'active', $3::jsonb, 'seed-eparagony-g10',
               '["Invoicing","Fiscalization"]'::jsonb, 'eparagony.documents.v3')
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, status = 'active', config = EXCLUDED.config,
         "enabledCapabilities" = EXCLUDED."enabledCapabilities", "adapterKey" = EXCLUDED."adapterKey"`,
      [G10_CONNECTION_ID, G10_CONNECTION_NAME, JSON.stringify(config)]
    );
    await client.query(
      `INSERT INTO connections
         (id, "platformType", name, status, config, "credentialsRef", "enabledCapabilities", "adapterKey")
       VALUES ($1, 'ksef', 'KSeF (G10 seed)', 'disabled', '{}'::jsonb, 'seed-ksef-g10',
               '["Invoicing"]'::jsonb, 'ksef.publicapi.v2')
       ON CONFLICT (id) DO NOTHING`,
      [G10_OTHER_CONNECTION_ID]
    );

    const orders: Array<[string, string, string, string | null]> = [
      [G10_ORDER_IDS.b2b, 'G10-B2B-1', 'Anna Kowalska', G10_BUYER_TAX_ID],
      [G10_ORDER_IDS.b2c, 'G10-B2C-1', 'Jan Nowak', null],
      [G10_ORDER_IDS.documented, 'G10-DOC-1', 'Marek Dabrowski', G10_BUYER_TAX_ID],
    ];
    for (const [orderId, orderNumber, buyer, taxId] of orders) {
      await client.query(
        `INSERT INTO order_records
           ("internalOrderId", "sourceConnectionId", "orderSnapshot", "recordStatus", "placedAt",
            "currency", "totalAmount", "buyerTaxId", "createdAt", "updatedAt")
         VALUES ($1, $2, $3::jsonb, 'ready', '2026-09-24T19:40:00Z', 'PLN', 123.00, $4, now(), now())`,
        [orderId, G10_SOURCE_CONNECTION_ID, snapshot(orderId, orderNumber, buyer, taxId), taxId]
      );
    }

    // What the gate persists for a paid order on a batched kind: the queue.
    await client.query(
      `UPDATE order_records
          SET "salesDocumentBlockReason" = 'trigger-model-batched',
              "salesDocumentBlockConnectionId" = $2,
              "salesDocumentBlockDocumentKind" = 'invoice'
        WHERE "internalOrderId" = ANY($1::text[])`,
      [[G10_ORDER_IDS.b2b, G10_ORDER_IDS.documented], G10_CONNECTION_ID]
    );

    // The document the `documented` order already has, on another connection.
    await client.query(
      `INSERT INTO invoice_records
         (id, "connectionId", "orderId", "providerType", "documentType", status, "regulatoryStatus",
          "issuedAt", "createdAt", "updatedAt")
       VALUES (uuid_generate_v4(), $1, $2, 'ksef', 'invoice', 'issued', 'accepted', now(), now(), now())`,
      [G10_OTHER_CONNECTION_ID, G10_ORDER_IDS.documented]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

/** Rows of one order's sales documents and issue jobs, for the "exactly once" checks. */
export async function countOrderDocuments(orderId: string): Promise<{
  invoiceRecords: number;
  issueJobs: number;
}> {
  const env = resolveEnv();
  const client = new pg.Client({ connectionString: env.databaseUrl });
  await client.connect();
  try {
    const invoices = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM invoice_records WHERE "orderId" = $1`,
      [orderId]
    );
    const jobs = await client.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM sync_jobs
        WHERE "jobType" = 'invoicing.issue' AND "payloadJson"->>'orderId' = $1`,
      [orderId]
    );
    return {
      invoiceRecords: Number(invoices.rows[0]?.n ?? 0),
      issueJobs: Number(jobs.rows[0]?.n ?? 0),
    };
  } finally {
    await client.end();
  }
}
