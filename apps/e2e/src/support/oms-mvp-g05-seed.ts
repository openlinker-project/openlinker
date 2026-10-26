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

/** Remove every order this module wrote. */
export async function clearG05Seed(): Promise<void> {
  await withClient('clearG05Seed', async (client) => {
    await client.query(`DELETE FROM order_records WHERE "internalOrderId" = ANY($1::text[])`, [
      [...G05_ORDER_IDS],
    ]);
  });
}
