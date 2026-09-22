/**
 * Pack-bench / Assign Packing Work E2E seed (#3342/#3343)
 *
 * A `FulfillmentWork` row reaching the bench needs the full OMS routing chain
 * — an `openlinker`-platform connection claiming `sourcingAuthority`, an
 * active `inventory_locations` row, a routed order and a dispatch/accept
 * handshake (ADR-054, #2408/#2409/#2955). There is no HTTP endpoint that
 * manufactures a `FulfillmentWork` directly — orders arrive from real
 * ingestion and the handshake auto-accepts only through a real
 * `fulfillment.work.dispatch` job. This module writes the terminal state
 * directly into Postgres instead, the same exception this package's
 * `sales-document-market-seed.ts` documents for a state "no HTTP API can
 * manufacture on demand": `connections`, `inventory_locations`,
 * `order_records`, `fulfillment_works` (+ lines, + holds) rows in whatever
 * shape a bench state needs, at `status='open'` / `requestStatus='accepted'`
 * (`BENCH_WORK_STATUSES` / `BENCH_WORK_REQUEST_STATUSES`,
 * `apps/api/src/bench/application/bench-work-eligibility.ts`) so the bench's
 * own read services treat the row exactly as they would a live-routed one.
 *
 * Every state function DELETES every row this module owns first, then
 * inserts exactly what the target state needs — so calling it twice in a row
 * (two specs, or a retry) always leaves exactly one clean scenario rather
 * than accumulating siblings that change which parcel the bench shows.
 *
 * `listPackingExecutors()` (`apps/api/src/bench/`) is UNSCOPED by packer
 * identity (spec D2, "the bench is a device label, not a principal") — every
 * packer session sees the same accepted+open work across every
 * `FulfillmentExecutor` connection. "Empty" therefore needs no second
 * connection, only zero seeded work.
 *
 * @module support
 */
import pg from 'pg';
type Client = InstanceType<typeof pg.Client>;
import { resolveEnv } from '../config/env';
import { assertSeedableDatabase } from './assert-seedable-database';

/** Fixed ids this module owns — every one is deleted before a re-seed. */
export const BENCH_SEED_IDS = {
  sourceConnection: '44444444-4444-4444-a444-444444444401',
  omsConnection: '44444444-4444-4444-a444-444444444402',
  location: 'ol_location_e2ebenchseed0001',
  product: 'ol_product_e2ebenchseed000001',
  variant: 'ol_variant_e2ebenchseed000001',
} as const;

const ORDER_IDS = {
  working: 'ol_order_e2ebenchworking00001',
  ready: 'ol_order_e2ebenchready000001',
  hold: 'ol_order_e2ebenchhold0000001',
  unlabelled: 'ol_order_e2ebenchunlabel0001',
} as const;

const WORK_IDS = {
  working: 'ol_fulfillmentwork_e2ebenchworking01',
  ready: 'ol_fulfillmentwork_e2ebenchready0001',
  hold: 'ol_fulfillmentwork_e2ebenchhold00001',
  unlabelled: 'ol_fulfillmentwork_e2ebenchunlabel1',
} as const;

export type BenchSeedState = 'working' | 'ready' | 'hold' | 'unlabelled' | 'empty';

export interface BenchSeedResult {
  readonly workId: string;
  readonly orderReference: string;
  readonly sku: string;
  readonly ean: string;
  readonly buyerName: string;
}

const SKU = 'E2E-BENCH-SKU-01';
const EAN = '5901234123457';

function orderSnapshot(orderNumber: string): string {
  return JSON.stringify({
    orderNumber,
    shippingAddress: { firstName: 'Anna', lastName: 'Kowalska', country: 'PL', city: 'Kraków' },
    channel: 'allegro',
  });
}

/** Deletes every row this module has ever written, across every state. */
async function clean(client: Client): Promise<void> {
  const workIds = Object.values(WORK_IDS);
  const orderIds = Object.values(ORDER_IDS);
  await client.query(`DELETE FROM fulfillment_holds WHERE "fulfillmentWorkId" = ANY($1::text[])`, [
    workIds,
  ]);
  await client.query(`DELETE FROM fulfillment_work_lines WHERE "fulfillmentWorkId" = ANY($1::text[])`, [
    workIds,
  ]);
  await client.query(`DELETE FROM shipments WHERE "orderId" = ANY($1::text[])`, [orderIds]);
  await client.query(`DELETE FROM fulfillment_works WHERE id = ANY($1::text[])`, [workIds]);
  await client.query(`DELETE FROM order_records WHERE "internalOrderId" = ANY($1::text[])`, [
    orderIds,
  ]);
}

async function ensureFixtures(client: Client): Promise<void> {
  await client.query(
    `INSERT INTO connections (id, "platformType", name, status, config, "credentialsRef", "enabledCapabilities")
     VALUES ($1, 'prestashop', 'E2E bench seed source', 'active', '{}'::jsonb, 'db:e2e-bench-seed-source', '[]'::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [BENCH_SEED_IDS.sourceConnection],
  );
  // `config` is reset on conflict too — a prior `empty`-state run flips
  // `sourcingAuthority.enabled` to `false` (see below) and, unlike the other
  // columns here, that would otherwise persist across every LATER seed call,
  // since `ON CONFLICT` only touches the columns it names.
  await client.query(
    `INSERT INTO connections (id, "platformType", name, status, config, "credentialsRef", "enabledCapabilities")
     VALUES ($1, 'openlinker', 'E2E packing bench', 'active', '{"sourcingAuthority":{"enabled":true}}'::jsonb, '', '["FulfillmentExecutor"]'::jsonb)
     ON CONFLICT (id) DO UPDATE SET status = 'active', config = '{"sourcingAuthority":{"enabled":true}}'::jsonb, "enabledCapabilities" = '["FulfillmentExecutor"]'::jsonb`,
    [BENCH_SEED_IDS.omsConnection],
  );
  await client.query(
    `INSERT INTO inventory_locations (id, code, name, kind, status, "countryIso2", postcode)
     VALUES ($1, 'E2EBENCH', 'E2E bench warehouse', 'warehouse', 'active', 'PL', '30-001')
     ON CONFLICT (id) DO NOTHING`,
    [BENCH_SEED_IDS.location],
  );
  await client.query(
    `INSERT INTO products (id, name, sku, price) VALUES ($1, 'E2E bench product', $2, 19.99)
     ON CONFLICT (id) DO NOTHING`,
    [BENCH_SEED_IDS.product, SKU],
  );
  await client.query(
    `INSERT INTO product_variants (id, "productId", sku, ean, gtin)
     VALUES ($1, $2, $3, $4, $4)
     ON CONFLICT (id) DO NOTHING`,
    [BENCH_SEED_IDS.variant, BENCH_SEED_IDS.product, SKU, EAN],
  );
}

async function insertOrder(client: Client, orderId: string, orderNumber: string): Promise<void> {
  await client.query(
    `INSERT INTO order_records ("internalOrderId", "sourceConnectionId", "orderSnapshot", "recordStatus", "placedAt", "currency", "totalAmount", "createdAt", "updatedAt")
     VALUES ($1, $2, $3::jsonb, 'ready', now(), 'PLN', 39.98, now(), now())
     ON CONFLICT ("internalOrderId") DO UPDATE SET "orderSnapshot" = $3::jsonb, "updatedAt" = now()`,
    [orderId, BENCH_SEED_IDS.sourceConnection, orderSnapshot(orderNumber)],
  );
}

async function insertWork(
  client: Client,
  workId: string,
  orderId: string,
  opts: { fulfilledQuantity: number; parcelClosedAt: string | null },
): Promise<void> {
  // `CHK_fulfillment_works_closed_parcel_actor` refuses a closed parcel
  // naming neither `packedByUserId` nor `packedByService` — a closed row
  // must always name who packed it. `packedByService` (never
  // `packedByUserId`, which would collide with `CHK_fulfillment_works_packed_actor`'s
  // mutual-exclusion) is set only when `parcelClosedAt` is being seeded.
  await client.query(
    `INSERT INTO fulfillment_works
       (id, "orderId", "locationId", "assignedConnectionId", "deliveryMethod", status, "requestStatus", "acceptedAt", "parcelClosedAt", "packedByService")
     VALUES ($1, $2, $3, $4, 'courier', 'open', 'accepted', now(), $5, $6)`,
    [
      workId,
      orderId,
      BENCH_SEED_IDS.location,
      BENCH_SEED_IDS.omsConnection,
      opts.parcelClosedAt,
      opts.parcelClosedAt === null ? null : 'e2e-seed',
    ],
  );
  await client.query(
    `INSERT INTO fulfillment_work_lines
       (id, "fulfillmentWorkId", "orderLineId", "productVariantId", "totalQuantity", "fulfilledQuantity", "cancelledQuantity")
     VALUES (gen_random_uuid(), $1, 'line-1', $2, 2, $3, 0)`,
    [workId, BENCH_SEED_IDS.variant, opts.fulfilledQuantity],
  );
}

/**
 * Seed the bench into exactly one state. Idempotent: always cleans every row
 * this module owns first.
 */
export async function seedBenchState(state: BenchSeedState): Promise<BenchSeedResult | null> {
  assertSeedableDatabase(`seedBenchState:${state}`);
  const env = resolveEnv();
  const client = new pg.Client({ connectionString: env.databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    await clean(client);
    await ensureFixtures(client);

    if (state === 'empty') {
      // The mockup's own `empty` pill reads "Nothing routed" and its panel
      // copy is "OpenLinker is not sending packing work here… turns on
      // packing… who decides what" — the NOT-ROUTED empty state
      // (`BenchWorkEmpty`'s `routingReady: false` arm), not the idle,
      // pipe-healthy one. Disabling `sourcingAuthority` here is what makes
      // the real app match what the mockup actually demonstrates; the idle
      // variant has no mockup panel to compare against and is out of scope.
      await client.query(
        `UPDATE connections SET config = '{"sourcingAuthority":{"enabled":false}}'::jsonb WHERE id = $1`,
        [BENCH_SEED_IDS.omsConnection],
      );
      await client.query('COMMIT');
      return null;
    }

    const orderId = ORDER_IDS[state];
    const workId = WORK_IDS[state];
    const orderNumber = `E2E-${state.toUpperCase()}-001`;
    await insertOrder(client, orderId, orderNumber);

    switch (state) {
      case 'working':
        await insertWork(client, workId, orderId, { fulfilledQuantity: 0, parcelClosedAt: null });
        break;
      case 'ready':
        await insertWork(client, workId, orderId, { fulfilledQuantity: 2, parcelClosedAt: null });
        break;
      case 'hold':
        await insertWork(client, workId, orderId, { fulfilledQuantity: 0, parcelClosedAt: null });
        await client.query(
          `INSERT INTO fulfillment_holds (id, "fulfillmentWorkId", reason, note, "placedByService", "placedAt")
           VALUES (gen_random_uuid(), $1, 'operator', 'E2E seeded hold', 'e2e-seed', now())`,
          [workId],
        );
        break;
      case 'unlabelled':
        // Closed, PLUS a real `shipments` row whose label attempt FAILED
        // (`providerShipmentId IS NULL`). `BenchDocumentsService.describeLabel`
        // maps a work with NO shipment row at all to `state: 'none'` (never
        // attempted), and only a shipment that exists but carries no
        // provider id to `state: 'unavailable'` — the "packed, no label"
        // panel Surface F renders. A closed work with zero shipment rows is
        // a different, unrelated state.
        await insertWork(client, workId, orderId, {
          fulfilledQuantity: 2,
          parcelClosedAt: new Date().toISOString(),
        });
        await client.query(
          `INSERT INTO shipments
             (id, "orderId", "connectionId", "fulfillmentWorkId", "shippingMethod", status, direction, carrier, "providerCode", "errorMessage", "failedAt")
           VALUES ($1, $2, $3, $4, 'courier', 'failed', 'outbound', 'InPost', 'LABEL_GENERATION_FAILED', 'E2E seeded label failure', now())`,
          [`ol_shipment_${workId}`, orderId, BENCH_SEED_IDS.omsConnection, workId],
        );
        break;
    }

    await client.query('COMMIT');
    return { workId, orderReference: orderNumber, sku: SKU, ean: EAN, buyerName: 'Anna Kowalska' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

/** Deletes every row this module owns. Call from an `afterAll`. */
export async function clearBenchSeed(): Promise<void> {
  assertSeedableDatabase('clearBenchSeed');
  const env = resolveEnv();
  const client = new pg.Client({ connectionString: env.databaseUrl });
  await client.connect();
  try {
    await clean(client);
  } finally {
    await client.end();
  }
}
