/**
 * Assign Packing Work E2E seed (#3343)
 *
 * Reuses `bench-seed.ts`'s connection/location/product/variant fixtures (same
 * OMS routing-chain exception documented there) and adds its own set of
 * `fulfillment_works` rows exercising the staffing axis ADR-074 added
 * (`assignedToUserId` / `selfServeEligible`) rather than the execution states
 * `bench-seed.ts` covers: one UNASSIGNED task, one already assigned to a named
 * packer, and one held.
 *
 * @module support
 */
import pg from 'pg';
type Client = InstanceType<typeof pg.Client>;
import { resolveEnv } from '../config/env';
import { assertSeedableDatabase } from './assert-seedable-database';
import { BENCH_SEED_IDS } from './bench-seed';

const ORDER_IDS = {
  unassigned: 'ol_order_e2eapwunassigned0001',
  assigned: 'ol_order_e2eapwassigned00001',
  held: 'ol_order_e2eapwheld000000001',
} as const;

export const ASSIGN_PACKING_WORK_IDS = {
  unassigned: 'ol_fulfillmentwork_e2eapwunassign1',
  assigned: 'ol_fulfillmentwork_e2eapwassigned1',
  held: 'ol_fulfillmentwork_e2eapwheld00001',
} as const;

function orderSnapshot(orderNumber: string): string {
  return JSON.stringify({
    orderNumber,
    shippingAddress: { firstName: 'Ewa', lastName: 'Nowicka', country: 'PL', city: 'Poznań' },
    channel: 'allegro',
  });
}

async function clean(client: Client): Promise<void> {
  const workIds = Object.values(ASSIGN_PACKING_WORK_IDS);
  const orderIds = Object.values(ORDER_IDS);
  await client.query(`DELETE FROM fulfillment_holds WHERE "fulfillmentWorkId" = ANY($1::text[])`, [
    workIds,
  ]);
  await client.query(`DELETE FROM fulfillment_work_lines WHERE "fulfillmentWorkId" = ANY($1::text[])`, [
    workIds,
  ]);
  await client.query(`DELETE FROM fulfillment_works WHERE id = ANY($1::text[])`, [workIds]);
  await client.query(`DELETE FROM order_records WHERE "internalOrderId" = ANY($1::text[])`, [
    orderIds,
  ]);
}

export interface AssignPackingWorkSeedResult {
  readonly unassignedWorkId: string;
  readonly assignedWorkId: string;
  readonly heldWorkId: string;
}

/**
 * Seeds three fulfillment_works rows: unassigned, pre-assigned to
 * `assignedToPackerId` with `selfServeEligible = true`, and held. Assumes
 * `bench-seed.ts`'s connection/location/product/variant fixtures already
 * exist — call `seedBenchState` (any state) first, or this insert's FKs fail.
 */
export async function seedAssignPackingWork(
  assignedToPackerId: string,
): Promise<AssignPackingWorkSeedResult> {
  assertSeedableDatabase('seedAssignPackingWork');
  const env = resolveEnv();
  const client = new pg.Client({ connectionString: env.databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    await clean(client);

    for (const [key, orderId] of Object.entries(ORDER_IDS) as [keyof typeof ORDER_IDS, string][]) {
      await client.query(
        `INSERT INTO order_records ("internalOrderId", "sourceConnectionId", "orderSnapshot", "recordStatus", "placedAt", "currency", "totalAmount", "createdAt", "updatedAt")
         VALUES ($1, $2, $3::jsonb, 'ready', now(), 'PLN', 39.98, now(), now())
         ON CONFLICT ("internalOrderId") DO UPDATE SET "orderSnapshot" = $3::jsonb, "updatedAt" = now()`,
        [orderId, BENCH_SEED_IDS.sourceConnection, orderSnapshot(`E2E-APW-${key.toUpperCase()}-001`)],
      );
    }

    const insertWork = async (
      workId: string,
      orderId: string,
      opts: { assignedToUserId: string | null; selfServeEligible: boolean },
    ): Promise<void> => {
      await client.query(
        `INSERT INTO fulfillment_works
           (id, "orderId", "locationId", "assignedConnectionId", "deliveryMethod", status, "requestStatus", "acceptedAt", "assignedToUserId", "selfServeEligible")
         VALUES ($1, $2, $3, $4, 'courier', 'open', 'accepted', now(), $5, $6)`,
        [
          workId,
          orderId,
          BENCH_SEED_IDS.location,
          BENCH_SEED_IDS.omsConnection,
          opts.assignedToUserId,
          opts.selfServeEligible,
        ],
      );
      await client.query(
        `INSERT INTO fulfillment_work_lines
           (id, "fulfillmentWorkId", "orderLineId", "productVariantId", "totalQuantity", "fulfilledQuantity", "cancelledQuantity")
         VALUES (gen_random_uuid(), $1, 'line-1', $2, 2, 0, 0)`,
        [workId, BENCH_SEED_IDS.variant],
      );
    };

    await insertWork(ASSIGN_PACKING_WORK_IDS.unassigned, ORDER_IDS.unassigned, {
      assignedToUserId: null,
      selfServeEligible: true,
    });
    await insertWork(ASSIGN_PACKING_WORK_IDS.assigned, ORDER_IDS.assigned, {
      assignedToUserId: assignedToPackerId,
      selfServeEligible: true,
    });
    await insertWork(ASSIGN_PACKING_WORK_IDS.held, ORDER_IDS.held, {
      assignedToUserId: null,
      selfServeEligible: true,
    });

    await client.query('COMMIT');
    return {
      unassignedWorkId: ASSIGN_PACKING_WORK_IDS.unassigned,
      assignedWorkId: ASSIGN_PACKING_WORK_IDS.assigned,
      heldWorkId: ASSIGN_PACKING_WORK_IDS.held,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

export async function clearAssignPackingWorkSeed(): Promise<void> {
  assertSeedableDatabase('clearAssignPackingWorkSeed');
  const env = resolveEnv();
  const client = new pg.Client({ connectionString: env.databaseUrl });
  await client.connect();
  try {
    await clean(client);
  } finally {
    await client.end();
  }
}
