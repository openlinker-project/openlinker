/**
 * Invoices-list state seed (#3188 e2e coverage)
 *
 * `tests/invoicing/invoices-list.spec.ts` verifies `/invoices`
 * (`apps/web/src/pages/invoicing/invoices-list-page.tsx`) — specifically the
 * `Buyer tax ID` column (`OrderBuyerTaxIdValue`, #3188) and the
 * `taxId=with|without` filter. No e2e HTTP path issues a real fiscal document
 * on demand (that needs a live KSeF/eparagony session), so this module writes
 * the `order_records` + `invoice_records` rows directly — the same narrow,
 * documented exception `sales-document-seed.ts` and
 * `sales-document-market-seed.ts` already take for exactly this reason (a
 * state with no write path, not a slower one skipped).
 *
 * Three rows, three `buyerTaxId` states (#3180/#3188's three-state encoding —
 * `NULL` = not asserted, `''` = asserted-none, a string = present):
 *  - `withTaxId`    — a real tax id frozen on the document at issue.
 *  - `withoutTaxId` — `NULL`, i.e. the source never asserted one.
 *  - `noneAsserted` — `''`, i.e. the source positively asserted "no tax id".
 *
 * Idempotent: fixed `m10seed`-prefixed ids, deletes its own rows first.
 *
 * @module support
 */
import { Client } from 'pg';
import { resolveEnv } from '../config/env';
import { assertSeedableDatabase } from './assert-seedable-database';

export const INVOICES_LIST_SEED_CONNECTION_ID = '22222222-2222-4222-a222-222222222201';

export const INVOICES_LIST_SEED_ORDER_IDS = {
  withTaxId: 'ol_order_m10seedinvlist01withtaxid00',
  withoutTaxId: 'ol_order_m10seedinvlist02notaxid000',
  noneAsserted: 'ol_order_m10seedinvlist03noneassert',
} as const;

/** The exact tax id frozen on the `withTaxId` document — asserted verbatim by the spec. */
export const INVOICES_LIST_SEED_BUYER_TAX_ID = 'PL9876543210';

function orderSnapshot(city: string, customerName: string): string {
  return JSON.stringify({
    customer: { name: customerName },
    shippingAddress: { country: 'PL', city },
    channel: 'allegro',
  });
}

export async function seedInvoicesListFixture(): Promise<void> {
  assertSeedableDatabase('seedInvoicesListFixture');
  const env = resolveEnv();
  const client = new Client({ connectionString: env.databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');

    const orderIds = Object.values(INVOICES_LIST_SEED_ORDER_IDS);
    await client.query(`DELETE FROM invoice_records WHERE "orderId" = ANY($1::text[])`, [
      orderIds,
    ]);
    await client.query(`DELETE FROM order_records WHERE "internalOrderId" = ANY($1::text[])`, [
      orderIds,
    ]);

    await client.query(
      `INSERT INTO connections (id, "platformType", name, status, config, "credentialsRef", "enabledCapabilities")
       VALUES ($1, 'ksef', 'Ksef Invoices-list (M10 seed)', 'active', '{}'::jsonb, 'seed-ksef-invlist', '["Invoicing"]'::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [INVOICES_LIST_SEED_CONNECTION_ID],
    );

    const orders: Array<[string, string]> = [
      [INVOICES_LIST_SEED_ORDER_IDS.withTaxId, 'Warszawa'],
      [INVOICES_LIST_SEED_ORDER_IDS.withoutTaxId, 'Krakow'],
      [INVOICES_LIST_SEED_ORDER_IDS.noneAsserted, 'Gdansk'],
    ];
    for (const [orderId, city] of orders) {
      await client.query(
        `INSERT INTO order_records
           ("internalOrderId", "sourceConnectionId", "orderSnapshot", "recordStatus", "placedAt", "currency", "totalAmount", "createdAt", "updatedAt")
         VALUES ($1, $2, $3::jsonb, 'ready', now(), 'PLN', 199.00, now(), now())`,
        [orderId, INVOICES_LIST_SEED_CONNECTION_ID, orderSnapshot(city, 'M10 Seed Buyer')],
      );
    }

    // Real tax id, frozen at issue (#3188) — `hasBuyerTaxId` and `buyerTaxId`
    // are the SAME fact on two columns (the boolean filter, the value column)
    // and must agree, or the `taxId=with` filter and the rendered value would
    // disagree about the same row.
    await client.query(
      `INSERT INTO invoice_records
         (id, "connectionId", "orderId", "providerType", "documentType", status, "regulatoryStatus",
          "providerInvoiceNumber", "hasBuyerTaxId", "buyerTaxId", "issuedAt", "createdAt", "updatedAt")
       VALUES (uuid_generate_v4(), $1, $2, 'ksef', 'invoice', 'issued', 'accepted',
               'M10/SEED/0001', true, $3, now(), now(), now())`,
      [
        INVOICES_LIST_SEED_CONNECTION_ID,
        INVOICES_LIST_SEED_ORDER_IDS.withTaxId,
        INVOICES_LIST_SEED_BUYER_TAX_ID,
      ],
    );

    // Not asserted by the source — `NULL`, the "unknown" rendering.
    await client.query(
      `INSERT INTO invoice_records
         (id, "connectionId", "orderId", "providerType", "documentType", status, "regulatoryStatus",
          "providerInvoiceNumber", "hasBuyerTaxId", "buyerTaxId", "issuedAt", "createdAt", "updatedAt")
       VALUES (uuid_generate_v4(), $1, $2, 'ksef', 'invoice', 'issued', 'accepted',
               'M10/SEED/0002', false, NULL, now(), now(), now())`,
      [INVOICES_LIST_SEED_CONNECTION_ID, INVOICES_LIST_SEED_ORDER_IDS.withoutTaxId],
    );

    // Positively asserted "no tax id" — `''`, the third, distinct state.
    await client.query(
      `INSERT INTO invoice_records
         (id, "connectionId", "orderId", "providerType", "documentType", status, "regulatoryStatus",
          "providerInvoiceNumber", "hasBuyerTaxId", "buyerTaxId", "issuedAt", "createdAt", "updatedAt")
       VALUES (uuid_generate_v4(), $1, $2, 'ksef', 'invoice', 'issued', 'accepted',
               'M10/SEED/0003', false, '', now(), now(), now())`,
      [INVOICES_LIST_SEED_CONNECTION_ID, INVOICES_LIST_SEED_ORDER_IDS.noneAsserted],
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}
