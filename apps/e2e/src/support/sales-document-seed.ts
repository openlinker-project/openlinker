/**
 * Sales-document state seed (#2563 M10)
 *
 * `tests/sales-documents/` verifies the `/orders` money-cluster document line
 * against every state `resolveSalesDocumentCellState`
 * (`apps/web/src/features/orders/lib/sales-document-cell-state.ts`) can
 * produce: a fiscal receipt registering, an invoice the authority rejected, a
 * receipt stuck "unconfirmed", a duplicate document on a second connection.
 * None of those is reachable through OL's own HTTP API on demand — issuing a
 * real invoice or registering a real receipt requires a working KSeF/eparagony
 * session, and "the authority rejected it" or "a second connection also holds
 * a document" are conditions no endpoint lets a caller force.
 *
 * This module writes the rows directly, over the SAME Postgres the stack
 * under test uses (`E2E_DATABASE_URL`), reproducing exactly what a live
 * KSeF/eparagony round-trip would have persisted (verified against
 * `SalesDocumentViewService.getForOrders`, `invoice-record.orm-entity.ts` and
 * `fiscal-registration-record.orm-entity.ts` in `libs/core`). It is a
 * deliberate, narrow exception to this package's own rule ("assert OL UI + OL
 * REST API as the source of truth... never mock implementation details") —
 * every OTHER suite in this package reaches the stack exclusively through the
 * HTTP API, and this one does not because the states it covers have no write
 * path at all, not because a slower one was skipped.
 *
 * Idempotent: every row uses a fixed, `m10seed`-prefixed id, and the seed
 * clears its own rows before inserting, so re-running it (a second local run,
 * a CI retry) never accumulates duplicate orders or dangling records.
 *
 * @module support
 */
import { Client } from 'pg';
import { resolveEnv } from '../config/env';

/** Fixed connection ids — stable across seed runs, distinct from anything a real install would mint. */
export const SEED_CONNECTION_IDS = {
  ksef: '11111111-1111-1111-1111-111111111101',
  eparagony: '11111111-1111-1111-1111-111111111102',
  infakt: '11111111-1111-1111-1111-111111111103',
} as const;

/** Fixed order ids, one per target `/orders` cell state (#2551/#2552/#2553). */
export const SEED_ORDER_IDS = {
  fiscalNotIssued: 'ol_order_m10seed0001fiscalnotissued',
  invoiceIssued: 'ol_order_m10seed0002invoiceissued00',
  invoiceAuthorityRejected: 'ol_order_m10seed0003invoicerejected',
  fiscalRegistering: 'ol_order_m10seed0004fiscalregistering',
  fiscalUnconfirmed: 'ol_order_m10seed0005fiscalunconfirmed',
  noRouting: 'ol_order_m10seed0006noroutingcz0000',
  invoiceNotIssued: 'ol_order_m10seed0007invoicenotissued',
  invoiceAtAuthorityDuplicate: 'ol_order_m10seed0008invoiceatauth00',
} as const;

export type SeedOrderKey = keyof typeof SEED_ORDER_IDS;

function orderSnapshot(country: string, city: string, customerName: string): string {
  return JSON.stringify({
    customer: { name: customerName },
    shippingAddress: { country, city },
    channel: 'allegro',
  });
}

/**
 * Seed the fixed set of connections, country routing defaults, orders and
 * invoice/fiscal-registration records this suite's specs read.
 *
 * Two connections carry a `salesDocument.documentKind` (#2155 decision 4) but
 * NEITHER is `isPrimary` and neither has a country default of its own — that
 * makes an order routed through the bare fallback (no rule, no country
 * default: `noRouting`'s country, CZ) genuinely ambiguous
 * (`resolveSalesDocumentRoutingFromCandidates`), which is what produces the
 * real `documentKind: null` / "No routing" state rather than an arbitrary
 * pick. PL and DE each get an explicit country default instead, which is what
 * lets `fiscalNotIssued` / `invoiceNotIssued` resolve a kind with no document
 * yet.
 */
export async function seedSalesDocumentStates(): Promise<void> {
  const env = resolveEnv();
  const client = new Client({ connectionString: env.databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');

    // Clear this suite's own rows first, so a re-run never accumulates
    // duplicates and never trips the unique-idempotency-key index.
    const orderIds = Object.values(SEED_ORDER_IDS);
    await client.query(
      `DELETE FROM invoice_records WHERE "orderId" = ANY($1::text[])`,
      [orderIds],
    );
    await client.query(
      `DELETE FROM fiscal_registration_records WHERE "orderId" = ANY($1::text[])`,
      [orderIds],
    );
    await client.query(`DELETE FROM order_records WHERE "internalOrderId" = ANY($1::text[])`, [
      orderIds,
    ]);
    await client.query(
      `DELETE FROM sales_document_country_defaults WHERE connection_id = ANY($1::uuid[])`,
      [Object.values(SEED_CONNECTION_IDS)],
    );
    await client.query(`DELETE FROM connections WHERE id = ANY($1::uuid[])`, [
      Object.values(SEED_CONNECTION_IDS),
    ]);

    await client.query(
      `INSERT INTO connections (id, "platformType", name, status, config, "credentialsRef", "enabledCapabilities")
       VALUES
         ($1, 'ksef', 'Ksef Demo', 'active', '{"salesDocument":{"documentKind":"invoice"}}'::jsonb, 'seed-ksef', '["Invoicing"]'::jsonb),
         ($2, 'eparagony', 'e-paragony Sandbox', 'active', '{"salesDocument":{"documentKind":"fiscal-receipt"}}'::jsonb, 'seed-eparagony', '["Fiscalization"]'::jsonb),
         ($3, 'infakt', 'inFakt Production', 'needs_reauth', '{"salesDocument":{"documentKind":"invoice"}}'::jsonb, 'seed-infakt', '["Invoicing"]'::jsonb)`,
      [SEED_CONNECTION_IDS.ksef, SEED_CONNECTION_IDS.eparagony, SEED_CONNECTION_IDS.infakt],
    );

    await client.query(
      `INSERT INTO sales_document_country_defaults (country, document_kind, connection_id)
       VALUES ('PL', 'fiscal-receipt', $1), ('DE', 'invoice', $2)`,
      [SEED_CONNECTION_IDS.eparagony, SEED_CONNECTION_IDS.ksef],
    );

    const orders: Array<[string, string, string, string, string, string, number]> = [
      [
        SEED_ORDER_IDS.fiscalNotIssued,
        SEED_CONNECTION_IDS.eparagony,
        'PL',
        'Warszawa',
        'Anna Kowalska',
        'PLN',
        89.0,
      ],
      [
        SEED_ORDER_IDS.invoiceIssued,
        SEED_CONNECTION_IDS.ksef,
        'DE',
        'Berlin',
        'Piotr Nowak',
        'EUR',
        154.5,
      ],
      [
        SEED_ORDER_IDS.invoiceAuthorityRejected,
        SEED_CONNECTION_IDS.ksef,
        'DE',
        'Munich',
        'Marek Zielinski',
        'EUR',
        212.4,
      ],
      [
        SEED_ORDER_IDS.fiscalRegistering,
        SEED_CONNECTION_IDS.eparagony,
        'PL',
        'Wroclaw',
        'Katarzyna Wojcik',
        'PLN',
        45.85,
      ],
      [
        SEED_ORDER_IDS.fiscalUnconfirmed,
        SEED_CONNECTION_IDS.eparagony,
        'PL',
        'Gdansk',
        'Demo Openlinker',
        'PLN',
        397.95,
      ],
      [
        SEED_ORDER_IDS.noRouting,
        SEED_CONNECTION_IDS.eparagony,
        'CZ',
        'Praha',
        'Anna Kowalska',
        'CZK',
        35.85,
      ],
      [
        SEED_ORDER_IDS.invoiceNotIssued,
        SEED_CONNECTION_IDS.ksef,
        'DE',
        'Hamburg',
        'Norbert Kulus',
        'EUR',
        360.85,
      ],
      [
        SEED_ORDER_IDS.invoiceAtAuthorityDuplicate,
        SEED_CONNECTION_IDS.ksef,
        'DE',
        'Frankfurt',
        'Demo Openlinker',
        'EUR',
        526.95,
      ],
    ];

    for (const [orderId, sourceConnectionId, country, city, customerName, currency, total] of
      orders) {
      await client.query(
        `INSERT INTO order_records
           ("internalOrderId", "sourceConnectionId", "orderSnapshot", "recordStatus", "placedAt", "currency", "totalAmount", "createdAt", "updatedAt")
         VALUES ($1, $2, $3::jsonb, 'ready', now(), $4, $5, now(), now())`,
        [orderId, sourceConnectionId, orderSnapshot(country, city, customerName), currency, total],
      );
    }

    // Invoice: issued, no clearance conflict.
    await client.query(
      `INSERT INTO invoice_records
         (id, "connectionId", "orderId", "providerType", "documentType", status, "regulatoryStatus", "issuedAt", "createdAt", "updatedAt")
       VALUES (uuid_generate_v4(), $1, $2, 'ksef', 'invoice', 'issued', 'accepted', now(), now(), now())`,
      [SEED_CONNECTION_IDS.ksef, SEED_ORDER_IDS.invoiceIssued],
    );

    // Invoice: issued, then the authority rejected it.
    await client.query(
      `INSERT INTO invoice_records
         (id, "connectionId", "orderId", "providerType", "documentType", status, "regulatoryStatus", "issuedAt", "createdAt", "updatedAt")
       VALUES (uuid_generate_v4(), $1, $2, 'ksef', 'invoice', 'issued', 'rejected', now(), now(), now())`,
      [SEED_CONNECTION_IDS.ksef, SEED_ORDER_IDS.invoiceAuthorityRejected],
    );

    // Fiscal receipt: registering (in flight, no terminal answer yet).
    await client.query(
      `INSERT INTO fiscal_registration_records
         (id, "connectionId", "orderId", "providerType", "idempotencyKey", status, "createdAt", "updatedAt")
       VALUES (uuid_generate_v4(), $1, $2, 'eparagony', 'm10seed-key-fiscal-registering', 'registering', now(), now())`,
      [SEED_CONNECTION_IDS.eparagony, SEED_ORDER_IDS.fiscalRegistering],
    );

    // Fiscal receipt: failed, in-doubt — "Unconfirmed", never a blind retry.
    await client.query(
      `INSERT INTO fiscal_registration_records
         (id, "connectionId", "orderId", "providerType", "idempotencyKey", status, "failureMode", "failureReason", "createdAt", "updatedAt")
       VALUES (uuid_generate_v4(), $1, $2, 'eparagony', 'm10seed-key-fiscal-unconfirmed', 'failed', 'in-doubt', 'Provider did not confirm before the wait budget elapsed.', now(), now())`,
      [SEED_CONNECTION_IDS.eparagony, SEED_ORDER_IDS.fiscalUnconfirmed],
    );

    // Invoice: submitted to the authority (winner, newer), plus a SECOND
    // invoice record on a different connection (inFakt, older) — the
    // duplicate-document state. Ranking is createdAt DESC then id DESC
    // (`groupRankedRecords`), so the winner's timestamp must be the later one.
    await client.query(
      `INSERT INTO invoice_records
         (id, "connectionId", "orderId", "providerType", "documentType", status, "regulatoryStatus", "issuedAt", "createdAt", "updatedAt")
       VALUES (uuid_generate_v4(), $1, $2, 'infakt', 'invoice', 'issued', 'not-applicable', now() - interval '1 hour', now() - interval '1 hour', now() - interval '1 hour')`,
      [SEED_CONNECTION_IDS.infakt, SEED_ORDER_IDS.invoiceAtAuthorityDuplicate],
    );
    await client.query(
      `INSERT INTO invoice_records
         (id, "connectionId", "orderId", "providerType", "documentType", status, "regulatoryStatus", "issuedAt", "createdAt", "updatedAt")
       VALUES (uuid_generate_v4(), $1, $2, 'ksef', 'invoice', 'issued', 'submitted', now(), now(), now())`,
      [SEED_CONNECTION_IDS.ksef, SEED_ORDER_IDS.invoiceAtAuthorityDuplicate],
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}
