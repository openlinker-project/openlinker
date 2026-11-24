/**
 * addLine against a concurrent parcel close (#3935 review)
 *
 * `addLine` is an INSERT ... SELECT guarded on `parcelClosedAt IS NULL`. Without a
 * lock on the parent row the SELECT reads its snapshot at statement start, so a
 * close that commits while the insert runs is not seen and the line lands on a
 * closed parcel. Only a second connection can show it, so this is an integration
 * test: one transaction closes the parcel and stays open, `addLine` runs
 * meanwhile, then the close commits.
 *
 * @module apps/api/test/integration
 */
import {
  FULFILLMENT_WORK_REPOSITORY_TOKEN,
  type CreateFulfillmentWorkInput,
  type FulfillmentWork,
} from '@openlinker/core/fulfillment';

import {
  getTestHarness,
  resetTestHarness,
  teardownTestHarness,
  type IntegrationTestHarness,
} from './setup';

interface WorkRepositoryView {
  create(input: CreateFulfillmentWorkInput): Promise<FulfillmentWork>;
  addLine(
    workId: string,
    line: { orderLineId: string; productVariantId: string; totalQuantity: number }
  ): Promise<boolean>;
  claimParcelClose(
    input: { workId: string; closedAt: Date; packedByUserId: string },
    transaction?: unknown
  ): Promise<boolean>;
  runInTransaction<T>(fn: (transaction: unknown) => Promise<T>): Promise<T>;
}

describe('addLine versus a concurrent parcel close', () => {
  let harness: IntegrationTestHarness;
  let works: WorkRepositoryView;

  beforeAll(async () => {
    harness = await getTestHarness();
    works = harness.getApp().get<WorkRepositoryView>(FULFILLMENT_WORK_REPOSITORY_TOKEN);
  });
  afterEach(async () => {
    await resetTestHarness();
  });
  afterAll(async () => {
    await teardownTestHarness();
  });

  const createWork = (): Promise<FulfillmentWork> =>
    works.create({
      orderId: 'ol_order_race',
      locationId: 'ol_location_1',
      deliveryMethod: 'courier',
      assignedConnectionId: null,
      lines: [{ orderLineId: 'line-1', productVariantId: 'ol_variant_1', totalQuantity: 1 }],
    });

  it('should refuse the line when a close commits while the insert is waiting', async () => {
    const work = await createWork();
    let releaseClose: () => void = () => undefined;
    const closeMayCommit = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    let closeStarted: () => void = () => undefined;
    const closeHasUpdated = new Promise<void>((resolve) => {
      closeStarted = resolve;
    });

    const closing = works.runInTransaction(async (transaction) => {
      const closed = await works.claimParcelClose(
        {
          workId: work.id,
          closedAt: new Date(),
          packedByUserId: '33333333-3333-4333-8333-333333333333',
        },
        transaction
      );
      expect(closed).toBe(true);
      closeStarted();
      await closeMayCommit;
    });

    await closeHasUpdated;
    const adding = works.addLine(work.id, {
      orderLineId: 'op-gift:late',
      productVariantId: 'ol_variant_gift',
      totalQuantity: 1,
    });
    // Let the insert reach the locked row before the close commits.
    await new Promise((resolve) => setTimeout(resolve, 300));
    releaseClose();
    await closing;

    await expect(adding).resolves.toBe(false);
  });

  it('should add the line while the parcel is open', async () => {
    const work = await createWork();

    await expect(
      works.addLine(work.id, { orderLineId: 'op-gift:ok', productVariantId: 'ol_variant_gift', totalQuantity: 1 })
    ).resolves.toBe(true);
  });
});
