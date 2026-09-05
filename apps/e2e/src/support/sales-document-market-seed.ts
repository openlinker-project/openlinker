/**
 * Sales-document market seed (#2563 M10)
 *
 * `tests/sales-documents/settings-market-list.spec.ts` verifies the settings
 * page's market section (`SalesDocumentMarketSection`) and its per-country
 * routing dialog against the mockup's "Settings" page. Reaching a specific
 * market state needs a country that genuinely has orders but no routing —
 * something no HTTP API can manufacture on demand, since orders arrive from
 * real ingestion, never a manual "create an order" endpoint. This module
 * writes three fixed, fresh `order_records` rows directly into Postgres — the
 * one deliberate exception to this package's HTTP-only rule (mirrors
 * `sales-document-seed.ts`'s rationale for the orders-list-cell task).
 *
 * Deliberately DIFFERENT countries from `sales-document-seed.ts`'s PL/DE/CZ
 * (this module uses SE/FI/NO) so the two seeds can coexist on one stack
 * without one task's fixture changing the other's aggregate market count.
 *
 * ROUTING ITSELF is seeded through the REAL write API
 * (`api.salesDocuments.upsertCountryDefault` / `acknowledgeNoDocument`), not
 * SQL — unlike an exotic invoice/fiscal state, "set a country default" has an
 * ordinary, cheap, always-available HTTP path, and the settings-list spec
 * exercises it directly as part of driving the routing dialog. This module
 * only seeds the ORDERS (and the connections they need to exist for), leaving
 * every country UNCONFIGURED — each test then configures/acknowledges/resets
 * through the UI or the API as its scenario requires.
 *
 * Idempotent: fixed ids, deletes its own rows before inserting.
 *
 * @module support
 */
import { Client } from 'pg';
import { resolveEnv } from '../config/env';

// Version(4)/variant(a) nibbles kept deliberately valid — `PUT
// /sales-documents/country-defaults` validates `connectionId` with
// `@IsUUID()`, which checks the RFC 4122 variant bits, not just the
// 8-4-4-4-12 hex SHAPE. A superficially UUID-looking id with an invalid
// variant nibble (e.g. `...-3333-...`) passes casual inspection but fails
// that check with a 400 - measured live.
export const MARKET_SEED_CONNECTION_IDS = {
  invoicing: '33333333-3333-4333-a333-333333333301',
  fiscalization: '33333333-3333-4333-a333-333333333302',
} as const;

/** Countries this seed guarantees have at least one detected order. */
export const MARKET_SEED_COUNTRIES = {
  /** Left unconfigured by every test unless the test itself configures it. */
  unconfigured: 'FI',
  /** The country tests configure a routing default for, then reset. */
  toConfigure: 'SE',
  /** The country tests acknowledge as "no document, by choice", then undo. */
  toAcknowledge: 'NO',
} as const;

const ORDER_IDS = {
  FI: 'ol_order_m10seedmarket01fi000000000',
  SE: 'ol_order_m10seedmarket02se000000000',
  NO: 'ol_order_m10seedmarket03no000000000',
} as const;

function orderSnapshot(country: string, city: string, customerName: string): string {
  return JSON.stringify({
    customer: { name: customerName },
    shippingAddress: { country, city },
    channel: 'allegro',
  });
}

export async function seedSalesDocumentMarketOrders(): Promise<void> {
  const env = resolveEnv();
  const client = new Client({ connectionString: env.databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');

    const orderIds = Object.values(ORDER_IDS);
    await client.query(`DELETE FROM order_records WHERE "internalOrderId" = ANY($1::text[])`, [
      orderIds,
    ]);

    // Connections exist so the routing dialog's Invoice/Receipt selects have
    // a capable candidate to pick — status 'active', real capabilities
    // declared, no working credentials needed (the spec never calls the
    // adapter; setting a country default only checks `enabledCapabilities`,
    // per `SalesDocumentCapabilityGuardService`).
    await client.query(
      `INSERT INTO connections (id, "platformType", name, status, config, "credentialsRef", "enabledCapabilities")
       VALUES
         ($1, 'ksef', 'Ksef Nordics (M10 seed)', 'active', '{}'::jsonb, 'seed-ksef-nordics', '["Invoicing"]'::jsonb),
         ($2, 'eparagony', 'e-paragony Nordics (M10 seed)', 'active', '{}'::jsonb, 'seed-eparagony-nordics', '["Fiscalization"]'::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [MARKET_SEED_CONNECTION_IDS.invoicing, MARKET_SEED_CONNECTION_IDS.fiscalization],
    );

    // Clear any pre-existing routing for these three countries so every test
    // run starts from "detected, unconfigured" regardless of what a previous
    // (possibly interrupted) run left behind.
    await client.query(
      `DELETE FROM sales_document_country_defaults WHERE country = ANY($1::text[])`,
      [[MARKET_SEED_COUNTRIES.unconfigured, MARKET_SEED_COUNTRIES.toConfigure, MARKET_SEED_COUNTRIES.toAcknowledge]],
    );
    await client.query(
      `DELETE FROM sales_document_country_acknowledgments WHERE country = ANY($1::text[])`,
      [[MARKET_SEED_COUNTRIES.unconfigured, MARKET_SEED_COUNTRIES.toConfigure, MARKET_SEED_COUNTRIES.toAcknowledge]],
    );

    await client.query(
      `INSERT INTO order_records ("internalOrderId", "sourceConnectionId", "orderSnapshot", "recordStatus", "placedAt", "currency", "totalAmount", "createdAt", "updatedAt")
       VALUES
         ($1, $4, $5::jsonb, 'ready', now(), 'EUR', 42.00, now(), now()),
         ($2, $4, $6::jsonb, 'ready', now(), 'EUR', 58.00, now(), now()),
         ($3, $4, $7::jsonb, 'ready', now(), 'EUR', 71.00, now(), now())
       ON CONFLICT ("internalOrderId") DO UPDATE SET "placedAt" = now(), "updatedAt" = now()`,
      [
        ORDER_IDS.FI,
        ORDER_IDS.SE,
        ORDER_IDS.NO,
        MARKET_SEED_CONNECTION_IDS.invoicing,
        orderSnapshot(MARKET_SEED_COUNTRIES.unconfigured, 'Helsinki', 'Aino Korhonen'),
        orderSnapshot(MARKET_SEED_COUNTRIES.toConfigure, 'Stockholm', 'Erik Lindqvist'),
        orderSnapshot(MARKET_SEED_COUNTRIES.toAcknowledge, 'Oslo', 'Ingrid Haugen'),
      ],
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}
