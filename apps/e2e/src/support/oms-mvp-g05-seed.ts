/**
 * G05 order seed (#3546)
 *
 * The buyer-note, bench-acknowledgement and bulk-action golden paths need
 * orders carrying a buyer note, and a sandbox marketplace cannot produce one
 * on demand. `order_records` rows are therefore written straight into Postgres,
 * the same documented exception `bench-seed.ts` and
 * `sales-document-market-seed.ts` make for state no HTTP API can manufacture.
 *
 * Every function DELETES every row this module owns first, so a second call
 * (a retry, or two specs) always leaves exactly one clean scenario.
 *
 * Cancel and edit against a REAL channel are not seeded here: those need a
 * connection whose adapter can answer, so their specs locate an existing order
 * on the stack instead and skip with a named reason when none fits.
 *
 * @module support
 */
import pg from 'pg';
type Client = InstanceType<typeof pg.Client>;
import { resolveEnv } from '../config/env';
import { assertSeedableDatabase } from './assert-seedable-database';
import { seedBenchState, type BenchSeedResult } from './bench-seed';

const SOURCE_CONNECTION_ID = '44444444-4444-4444-a444-444444444501';

export const G05_NOTE_TEXT = 'E2E G05 buyer note: please leave the parcel with the neighbour';

/** Internal ids of the three bulk-action orders, in list order. */
export const G05_ORDER_IDS = [
  'ol_order_e2eg05bulk00000001',
  'ol_order_e2eg05bulk00000002',
  'ol_order_e2eg05bulk00000003',
] as const;

/** Orders for the mockup states the golden paths do not touch (#3546). */
export const G05_STATE_ORDER_IDS = {
  none: 'ol_order_e2eg05state00000none',
  long: 'ol_order_e2eg05state00000long',
  label: 'ol_order_e2eg05state0000label',
  packed: 'ol_order_e2eg05state000packed',
} as const;

const G05_LABEL_SHIPMENT_ID = 'ol_shipment_e2eg05state0000label';
const G05_MULTI_WORK_ID = 'ol_fulfillmentwork_e2eg05multi00001';

/** A note long enough to be clamped on order detail (the mockup's `long` is 563 characters). */
export const G05_LONG_NOTE_TEXT = [
  'Dzien dobry, zamawiam ten zestaw jako prezent urodzinowy dla mamy, dlatego mam kilka prosb:',
  '1) prosze o zapakowanie kazdego przedmiotu osobno, w papier a nie w folie babelkowa,',
  '2) prosze nie wkladac do paczki paragonu ani faktury, wszystko dostane mailem,',
  '3) jesli ktorys kubek bedzie uszkodzony, prosze o telefon przed wysylka, nie po,',
  '4) adres dostawy to adres mojej mamy, domofon nie dziala, prosze dzwonic do drzwi.',
  'Z gory dziekuje za pomoc i pozdrawiam serdecznie, to dla mnie wazne zamowienie.',
].join('\n');

function snapshot(orderNumber: string): string {
  return JSON.stringify({
    orderNumber,
    shippingAddress: { firstName: 'Jan', lastName: 'Nowak', country: 'PL', city: 'Warszawa' },
    channel: 'allegro',
  });
}

async function withClient<T>(label: string, run: (client: Client) => Promise<T>): Promise<T> {
  assertSeedableDatabase(label);
  const client = new pg.Client({ connectionString: resolveEnv().databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

async function ensureSourceConnection(client: Client): Promise<void> {
  await client.query(
    `INSERT INTO connections (id, "platformType", name, status, config, "credentialsRef", "enabledCapabilities")
     VALUES ($1, 'prestashop', 'E2E G05 seed source', 'active', '{}'::jsonb, 'db:e2e-g05-seed-source', '[]'::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [SOURCE_CONNECTION_ID],
  );
}

/**
 * Three ready orders, each with an UNREAD buyer note. Used by the buyer-note
 * read path (first order) and the bulk-action path (all three).
 */
export async function seedBuyerNoteOrders(): Promise<readonly string[]> {
  return withClient('seedBuyerNoteOrders', async (client) => {
    await client.query(`DELETE FROM order_records WHERE "internalOrderId" = ANY($1::text[])`, [
      [...G05_ORDER_IDS],
    ]);
    await ensureSourceConnection(client);
    for (const [index, orderId] of G05_ORDER_IDS.entries()) {
      await client.query(
        `INSERT INTO order_records
           ("internalOrderId", "sourceConnectionId", "orderSnapshot", "recordStatus", "placedAt", "currency", "totalAmount", "buyerNote", "hasBuyerNote", "createdAt", "updatedAt")
         VALUES ($1, $2, $3::jsonb, 'ready', now(), 'PLN', 39.98, $4, true, now(), now())`,
        [orderId, SOURCE_CONNECTION_ID, snapshot(`E2E-G05-BULK-00${index + 1}`), G05_NOTE_TEXT],
      );
    }
    return [...G05_ORDER_IDS];
  });
}

/**
 * The pack-bench "working" parcel (`bench-seed.ts`) with an unread buyer note
 * on its order, so the bench shows the note and the acknowledgement can be
 * recorded against a real `fulfillment_works` row.
 */
export async function seedBenchOrderWithBuyerNote(): Promise<{
  readonly seed: BenchSeedResult;
  readonly internalOrderId: string;
}> {
  const seed = await seedBenchState('working');
  if (seed === null) throw new Error("seedBenchState('working') unexpectedly returned no fixture");
  const internalOrderId = await withClient('seedBenchOrderWithBuyerNote', async (client) => {
    const found = await client.query<{ orderId: string }>(
      `SELECT "orderId" FROM fulfillment_works WHERE id = $1`,
      [seed.workId],
    );
    const orderId = found.rows[0]?.orderId;
    if (orderId === undefined) throw new Error(`bench work ${seed.workId} has no order row`);
    await client.query(
      `UPDATE order_records
          SET "buyerNote" = $2, "hasBuyerNote" = true, "buyerNoteReadAt" = NULL, "buyerNoteReadByUserId" = NULL
        WHERE "internalOrderId" = $1`,
      [orderId, G05_NOTE_TEXT],
    );
    await client.query(
      `UPDATE fulfillment_works
          SET "buyerNoteAcknowledgedAt" = NULL, "buyerNoteAcknowledgedByUserId" = NULL
        WHERE id = $1`,
      [seed.workId],
    );
    return orderId;
  });
  return { seed, internalOrderId };
}

async function clearStateRows(client: Client): Promise<void> {
  const stateIds = Object.values(G05_STATE_ORDER_IDS);
  await client.query(`DELETE FROM fulfillment_work_lines WHERE "fulfillmentWorkId" = $1`, [
    G05_MULTI_WORK_ID,
  ]);
  await client.query(`DELETE FROM fulfillment_works WHERE id = $1`, [G05_MULTI_WORK_ID]);
  await client.query(`DELETE FROM shipments WHERE "orderId" = ANY($1::text[])`, [stateIds]);
  await client.query(`DELETE FROM order_records WHERE "internalOrderId" = ANY($1::text[])`, [
    stateIds,
  ]);
}

async function insertStateOrder(
  client: Client,
  orderId: string,
  orderNumber: string,
  opts: { note: string | null; packed: boolean },
): Promise<void> {
  await client.query(
    `INSERT INTO order_records
       ("internalOrderId", "sourceConnectionId", "orderSnapshot", "recordStatus", "placedAt", "currency", "totalAmount", "buyerNote", "hasBuyerNote", "packedAt", "createdAt", "updatedAt")
     VALUES ($1, $2, $3::jsonb, 'ready', now(), 'PLN', 39.98, $4, $5, $6, now(), now())`,
    [
      orderId,
      SOURCE_CONNECTION_ID,
      snapshot(orderNumber),
      opts.note,
      opts.note !== null,
      opts.packed ? new Date().toISOString() : null,
    ],
  );
}

/** M2 `none`: a ready order with no buyer note at all. */
export async function seedOrderWithoutBuyerNote(): Promise<string> {
  return withClient('seedOrderWithoutBuyerNote', async (client) => {
    await clearStateRows(client);
    await ensureSourceConnection(client);
    await insertStateOrder(client, G05_STATE_ORDER_IDS.none, 'E2E-G05-NONE-001', {
      note: null,
      packed: false,
    });
    return G05_STATE_ORDER_IDS.none;
  });
}

/** M2 `long`: a ready order whose buyer note is long enough to be clamped. */
export async function seedOrderWithLongBuyerNote(): Promise<string> {
  return withClient('seedOrderWithLongBuyerNote', async (client) => {
    await clearStateRows(client);
    await ensureSourceConnection(client);
    await insertStateOrder(client, G05_STATE_ORDER_IDS.long, 'E2E-G05-LONG-001', {
      note: G05_LONG_NOTE_TEXT,
      packed: false,
    });
    return G05_STATE_ORDER_IDS.long;
  });
}

/**
 * M1 `cancel-label`: a ready order holding a `generated` outbound label on a
 * connection with no carrier adapter, so voiding it fails and the cancel is
 * refused with LABEL_NOT_VOIDABLE.
 */
export async function seedOrderWithGeneratedLabel(): Promise<string> {
  return withClient('seedOrderWithGeneratedLabel', async (client) => {
    await clearStateRows(client);
    await ensureSourceConnection(client);
    await insertStateOrder(client, G05_STATE_ORDER_IDS.label, 'E2E-G05-LABEL-001', {
      note: null,
      packed: false,
    });
    await client.query(
      `INSERT INTO shipments
         (id, "orderId", "connectionId", "shippingMethod", status, direction, carrier, "providerShipmentId")
       VALUES ($1, $2, $3, 'courier', 'generated', 'outbound', 'InPost', 'e2e-g05-label-0001')`,
      [G05_LABEL_SHIPMENT_ID, G05_STATE_ORDER_IDS.label, SOURCE_CONNECTION_ID],
    );
    return G05_STATE_ORDER_IDS.label;
  });
}

/** M1 `edit-blocked`: a ready order already marked packed, so editing is refused. */
export async function seedPackedOrder(): Promise<string> {
  return withClient('seedPackedOrder', async (client) => {
    await clearStateRows(client);
    await ensureSourceConnection(client);
    await insertStateOrder(client, G05_STATE_ORDER_IDS.packed, 'E2E-G05-PACKED-001', {
      note: null,
      packed: true,
    });
    return G05_STATE_ORDER_IDS.packed;
  });
}

/**
 * M2 `multi`: the bench "working" parcel with an unread note PLUS a second,
 * already closed parcel of the same order whose note reading was recorded by a
 * different user, so the bench shows "read on parcel 2 of 2". Returns the same
 * shape as {@link seedBenchOrderWithBuyerNote}.
 */
export async function seedBenchOrderWithTwoParcels(): Promise<{
  readonly seed: BenchSeedResult;
  readonly internalOrderId: string;
}> {
  const first = await seedBenchOrderWithBuyerNote();
  await withClient('seedBenchOrderWithTwoParcels', async (client) => {
    await clearStateRows(client);
    const user = await client.query<{ id: string }>(`SELECT id FROM users ORDER BY "createdAt" LIMIT 1`);
    const userId = user.rows[0]?.id;
    if (userId === undefined) throw new Error('no user row to attribute the second parcel reading to');
    const work = await client.query<{
      locationId: string;
      assignedConnectionId: string;
      productVariantId: string;
    }>(
      `SELECT w."locationId", w."assignedConnectionId", l."productVariantId"
         FROM fulfillment_works w
         JOIN fulfillment_work_lines l ON l."fulfillmentWorkId" = w.id
        WHERE w.id = $1 LIMIT 1`,
      [first.seed.workId],
    );
    const base = work.rows[0];
    if (base === undefined) throw new Error(`bench work ${first.seed.workId} has no line row`);
    await client.query(
      `INSERT INTO fulfillment_works
         (id, "orderId", "locationId", "assignedConnectionId", "deliveryMethod", status, "requestStatus", "acceptedAt", "parcelClosedAt", "packedByService", "buyerNoteAcknowledgedAt", "buyerNoteAcknowledgedByUserId")
       VALUES ($1, $2, $3, $4, 'courier', 'open', 'accepted', now(), now(), 'e2e-seed', now(), $5)`,
      [G05_MULTI_WORK_ID, first.internalOrderId, base.locationId, base.assignedConnectionId, userId],
    );
    await client.query(
      `INSERT INTO fulfillment_work_lines
         (id, "fulfillmentWorkId", "orderLineId", "productVariantId", "totalQuantity", "fulfilledQuantity", "cancelledQuantity")
       VALUES (gen_random_uuid(), $1, 'line-2', $2, 2, 2, 0)`,
      [G05_MULTI_WORK_ID, base.productVariantId],
    );
  });
  return first;
}

/** Remove every order this module wrote. */
export async function clearG05Seed(): Promise<void> {
  await withClient('clearG05Seed', async (client) => {
    await clearStateRows(client);
    await client.query(`DELETE FROM order_records WHERE "internalOrderId" = ANY($1::text[])`, [
      [...G05_ORDER_IDS],
    ]);
  });
}
