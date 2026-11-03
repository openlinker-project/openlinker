/**
 * The packing stage of an order, read for a whole `/orders` page (#3482) — integration
 *
 * Drives the real query service and repository against real Postgres. What only a
 * database can settle is the SHAPE the pack bench actually leaves behind: a parcel
 * shut on the bench keeps `status = 'open'` and records its progress in
 * `parcelClosedAt`. A unit test that feeds synthetic statuses cannot see that, and
 * the first version of this read reported "To pack" for a packed parcel because of
 * it. The partial `select` + `IN (...)` in `findProgressByOrderIds` is likewise only
 * proven by running it.
 *
 * @module apps/api/test/integration
 */
import {
  FULFILLMENT_WORK_QUERY_SERVICE_TOKEN,
  FULFILLMENT_WORK_REPOSITORY_TOKEN,
  type CreateFulfillmentWorkInput,
  type FulfillmentWork,
  type IFulfillmentWorkQueryService,
} from '@openlinker/core/fulfillment';

import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { IntegrationTestHarness } from './setup';

/**
 * The repository port is deliberately off the barrel (a `*RepositoryPort` is an
 * intra-context contract), so the token is resolved against a local structural
 * type — the `fulfillment-timeout-sweep.int-spec.ts` shape.
 */
interface WorkRepositoryView {
  create(input: CreateFulfillmentWorkInput): Promise<FulfillmentWork>;
}

describe('Order work summary (#3482)', () => {
  let harness: IntegrationTestHarness;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  const repository = (): WorkRepositoryView =>
    harness.getApp().get<WorkRepositoryView>(FULFILLMENT_WORK_REPOSITORY_TOKEN);

  const query = (): IFulfillmentWorkQueryService =>
    harness.getApp().get<IFulfillmentWorkQueryService>(FULFILLMENT_WORK_QUERY_SERVICE_TOKEN);

  const PACKER_USER_ID = '22222222-2222-2222-2222-222222222222';

  const seedWork = async (orderId: string, deliveryMethod = 'courier'): Promise<FulfillmentWork> =>
    repository().create({
      orderId,
      locationId: 'ol_location_1',
      deliveryMethod,
      assignedConnectionId: '11111111-1111-1111-1111-111111111111',
      lines: [{ orderLineId: 'l-1', productVariantId: 'ol_variant_1', totalQuantity: 1 }],
    });

  /**
   * What the bench does when it shuts a box: sets the column and the packer who
   * shut it, never `status`. A closed parcel must name its actor
   * (`CHK_fulfillment_works_closed_parcel_actor`).
   */
  const closeParcelOnBench = async (workId: string): Promise<void> => {
    await harness
      .getDataSource()
      .query(
        `UPDATE "fulfillment_works" SET "parcelClosedAt" = now(), "packedByUserId" = $2 WHERE "id" = $1`,
        [workId, PACKER_USER_ID]
      );
  };

  const setStatus = async (workId: string, status: string): Promise<void> => {
    await harness
      .getDataSource()
      .query(`UPDATE "fulfillment_works" SET "status" = $2 WHERE "id" = $1`, [workId, status]);
  };

  it('should read a freshly routed order as to-pack', async () => {
    await seedWork('ol_order_a');

    const summaries = await query().summarizeWorkForOrders(['ol_order_a']);

    expect(summaries.get('ol_order_a')).toEqual({
      stage: 'to-pack',
      workCount: 1,
      assignment: 'single',
      assignedToUserId: null,
    });
  });

  it('should read a bench-closed parcel as packed although its status is still open', async () => {
    const work = await seedWork('ol_order_a');
    await closeParcelOnBench(work.id);

    const summaries = await query().summarizeWorkForOrders(['ol_order_a']);

    expect(summaries.get('ol_order_a')).toEqual({
      stage: 'packed',
      workCount: 1,
      assignment: 'single',
      assignedToUserId: null,
    });
  });

  it('should leave an order with no work out of the result', async () => {
    await seedWork('ol_order_a');

    const summaries = await query().summarizeWorkForOrders(['ol_order_a', 'ol_order_without_work']);

    expect(summaries.has('ol_order_without_work')).toBe(false);
  });

  it('should not count a cancelled work, even one whose parcel was closed', async () => {
    const work = await seedWork('ol_order_a');
    await closeParcelOnBench(work.id);
    await setStatus(work.id, 'cancelled');

    const summaries = await query().summarizeWorkForOrders(['ol_order_a']);

    expect(summaries.has('ol_order_a')).toBe(false);
  });

  it('should report the earliest stage across the works of a split order', async () => {
    const packed = await seedWork('ol_order_a', 'courier');
    await seedWork('ol_order_a', 'pickup');
    await closeParcelOnBench(packed.id);

    const summaries = await query().summarizeWorkForOrders(['ol_order_a']);

    expect(summaries.get('ol_order_a')).toEqual({
      stage: 'to-pack',
      workCount: 2,
      assignment: 'single',
      assignedToUserId: null,
    });
  });

  it('should summarise every order of a page in one call', async () => {
    const packed = await seedWork('ol_order_a');
    await closeParcelOnBench(packed.id);
    await seedWork('ol_order_b');

    const summaries = await query().summarizeWorkForOrders(['ol_order_a', 'ol_order_b']);

    expect(summaries.get('ol_order_a')?.stage).toBe('packed');
    expect(summaries.get('ol_order_b')?.stage).toBe('to-pack');
  });

  it('should return an empty map without touching the database for an empty page', async () => {
    const summaries = await query().summarizeWorkForOrders([]);

    expect(summaries.size).toBe(0);
  });
});
