/**
 * Invoice regulatory-status seed (#3194)
 *
 * `sales-document-seed.ts` (the existing `/invoices` fixture) covers
 * `accepted`, `rejected`, `not-applicable` and `submitted` — never
 * `pending-submission` or `cleared`, the two `RegulatoryStatusValues` #3194
 * reinstates into the invoice list's regulatory-status filter (they used to
 * be deliberately excluded; see that filter's own doc comment). Neither state
 * has a live write path an e2e test can trigger on demand — `pending-
 * submission` is a degraded-mode window entered only when the authority is
 * genuinely unreachable at issuance, and `cleared` is a split-clearance
 * status no adapter in this tree emits yet — so this module writes the rows
 * directly, the same documented exception `sales-document-seed.ts` and
 * `sales-document-market-seed.ts` already take. A `not-applicable` row is
 * ALSO seeded here (even though the other fixture already produces one),
 * deliberately: this module must be usable standalone, and a spec run
 * against a stack that has never executed `sales-document-seed.ts` must
 * still find at least one `not-applicable` row of its own.
 *
 * `createdAt` is stamped `now()` on every row so the default-sorted (`inv.
 * createdAt DESC`, `invoice-record.repository.ts`), unfiltered first page of
 * `/invoices` reliably carries them — the "Awaiting submission" chip only
 * counts what is ON THE CURRENTLY LOADED PAGE (`invoices-list-page.tsx`'s own
 * doc comment), not an install-wide aggregate.
 *
 * The two `pending-submission` rows carry deliberately different `updatedAt`
 * values (one ~2 hours old, one just now) so the chip's age suffix — the
 * OLDEST `updatedAt` among them — has something non-zero to report.
 *
 * Idempotent: fixed ids, deletes its own rows before inserting.
 *
 * @module support
 */
import { Client } from 'pg';
import { resolveEnv } from '../config/env';
import { assertSeedableDatabase } from './assert-seedable-database';

export const REG_STATUS_SEED_CONNECTION_ID = '55555555-5555-4555-a555-555555555501';

export const REG_STATUS_SEED_ORDER_IDS = {
  pendingOld: 'ol_order_m10seedregpendingold00000',
  pendingNew: 'ol_order_m10seedregpendingnew00000',
  cleared: 'ol_order_m10seedregcleared0000000',
  notApplicable: 'ol_order_m10seedregnotapplicable0',
} as const;

function orderSnapshot(customerName: string): string {
  return JSON.stringify({
    customer: { name: customerName },
    shippingAddress: { country: 'PL', city: 'Warszawa' },
    channel: 'allegro',
  });
}

export async function seedInvoiceRegulatoryStatuses(): Promise<void> {
  assertSeedableDatabase('seedInvoiceRegulatoryStatuses');
  const env = resolveEnv();
  const client = new Client({ connectionString: env.databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');

    const orderIds = Object.values(REG_STATUS_SEED_ORDER_IDS);
    await client.query(`DELETE FROM invoice_records WHERE "orderId" = ANY($1::text[])`, [
      orderIds,
    ]);
    await client.query(`DELETE FROM order_records WHERE "internalOrderId" = ANY($1::text[])`, [
      orderIds,
    ]);

    await client.query(
      `INSERT INTO connections (id, "platformType", name, status, config, "credentialsRef", "enabledCapabilities")
       VALUES ($1, 'ksef', 'Ksef Regulatory Status Seed', 'active', '{}'::jsonb, 'seed-ksef-regstatus', '["Invoicing"]'::jsonb)
       ON CONFLICT (id) DO UPDATE SET status = 'active', "enabledCapabilities" = EXCLUDED."enabledCapabilities"`,
      [REG_STATUS_SEED_CONNECTION_ID],
    );

    const orders: Array<[string, string]> = [
      [REG_STATUS_SEED_ORDER_IDS.pendingOld, 'Regulatory Seed — Pending (old)'],
      [REG_STATUS_SEED_ORDER_IDS.pendingNew, 'Regulatory Seed — Pending (new)'],
      [REG_STATUS_SEED_ORDER_IDS.cleared, 'Regulatory Seed — Cleared'],
      [REG_STATUS_SEED_ORDER_IDS.notApplicable, 'Regulatory Seed — Not applicable'],
    ];
    for (const [orderId, customerName] of orders) {
      await client.query(
        `INSERT INTO order_records
           ("internalOrderId", "sourceConnectionId", "orderSnapshot", "recordStatus", "placedAt", "currency", "totalAmount", "createdAt", "updatedAt")
         VALUES ($1, $2, $3::jsonb, 'ready', now(), 'PLN', 99.00, now(), now())`,
        [orderId, REG_STATUS_SEED_CONNECTION_ID, orderSnapshot(customerName)],
      );
    }

    // pending-submission, older — the chip's "oldest" figure.
    await client.query(
      `INSERT INTO invoice_records
         (id, "connectionId", "orderId", "providerType", "documentType", status, "regulatoryStatus", "issuedAt", "createdAt", "updatedAt")
       VALUES (uuid_generate_v4(), $1, $2, 'ksef', 'invoice', 'issued', 'pending-submission', now() - interval '2 hours', now(), now() - interval '2 hours')`,
      [REG_STATUS_SEED_CONNECTION_ID, REG_STATUS_SEED_ORDER_IDS.pendingOld],
    );
    // pending-submission, just now.
    await client.query(
      `INSERT INTO invoice_records
         (id, "connectionId", "orderId", "providerType", "documentType", status, "regulatoryStatus", "issuedAt", "createdAt", "updatedAt")
       VALUES (uuid_generate_v4(), $1, $2, 'ksef', 'invoice', 'issued', 'pending-submission', now(), now(), now())`,
      [REG_STATUS_SEED_CONNECTION_ID, REG_STATUS_SEED_ORDER_IDS.pendingNew],
    );
    // cleared.
    await client.query(
      `INSERT INTO invoice_records
         (id, "connectionId", "orderId", "providerType", "documentType", status, "regulatoryStatus", "issuedAt", "createdAt", "updatedAt")
       VALUES (uuid_generate_v4(), $1, $2, 'ksef', 'invoice', 'issued', 'cleared', now(), now(), now())`,
      [REG_STATUS_SEED_CONNECTION_ID, REG_STATUS_SEED_ORDER_IDS.cleared],
    );
    // not-applicable — seeded here too rather than relied on from
    // `sales-document-seed.ts`'s own rows, so the `not-applicable` filter
    // assertion below is guaranteed at least one match on a stack that has
    // never run that other fixture.
    await client.query(
      `INSERT INTO invoice_records
         (id, "connectionId", "orderId", "providerType", "documentType", status, "regulatoryStatus", "issuedAt", "createdAt", "updatedAt")
       VALUES (uuid_generate_v4(), $1, $2, 'ksef', 'invoice', 'issued', 'not-applicable', now(), now(), now())`,
      [REG_STATUS_SEED_CONNECTION_ID, REG_STATUS_SEED_ORDER_IDS.notApplicable],
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}
