/**
 * Bulk Shop Publish Integration Test (#1044)
 *
 * Exercises the bulk shop-publish vertical against real Postgres (Testcontainers;
 * the #1042 `listing_creation_records` table + the #1044 `bulkBatchId` migration
 * `1807…` applied by the harness):
 *  - `BulkShopPublishSubmitService.submit` persists a `BulkListingBatch`
 *    (`totalCount` = fan-out, status `running`) and one `ListingCreationRecord`
 *    per variant, each carrying `bulkBatchId`; `getBatch` returns the summary;
 *  - the `bulkBatchId` column exists (migration applied);
 *  - the reused `BulkListingProgressService.advanceBatchStatus` increments the
 *    batch counters per child and derives the terminal status — proving the
 *    child-type-agnostic aggregate works for shop-publish children.
 *
 * The per-child enqueue puts jobs on Redis but the worker process isn't run
 * here; the DB-side batch + child persistence and counter advancement are what
 * this spec validates. The single-publish execution vertical (real adapter
 * seams) is covered by `shop-product-publish.int-spec.ts`.
 *
 * @module apps/api/test/integration/listings
 */
import {
  BULK_LISTING_PROGRESS_SERVICE_TOKEN,
  BULK_SHOP_PUBLISH_SUBMIT_SERVICE_TOKEN,
  type IBulkListingProgressService,
  type IBulkShopPublishSubmitService,
} from '@openlinker/core/listings';

import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from '../setup';
import { createTestConnection } from '../helpers/test-connection.helper';
import {
  installShopTestPublisherStub,
  type ShopTestPublisherStub,
} from '../helpers/shop-test-product-publisher-stub.helper';

const VARIANT_A = 'ol_variant_bulk_a';
const VARIANT_B = 'ol_variant_bulk_b';

describe('Bulk Shop Publish Integration (#1044)', () => {
  let harness: IntegrationTestHarness;
  let publisher: ShopTestPublisherStub;
  let shopConnectionId: string;

  beforeAll(async () => {
    harness = await getTestHarness();
    publisher = installShopTestPublisherStub(harness);
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  function submitService(): IBulkShopPublishSubmitService {
    return harness
      .getApp()
      .get<IBulkShopPublishSubmitService>(BULK_SHOP_PUBLISH_SUBMIT_SERVICE_TOKEN);
  }

  function progressService(): IBulkListingProgressService {
    return harness.getApp().get<IBulkListingProgressService>(BULK_LISTING_PROGRESS_SERVICE_TOKEN);
  }

  beforeEach(async () => {
    publisher.reset();
    const shop = await createTestConnection(harness.getDataSource(), {
      platformType: publisher.platformType,
      name: 'Bulk shop destination',
      adapterKey: publisher.adapterKey,
      enabledCapabilities: ['ProductPublisher', 'CategoryProvisioner'],
    });
    shopConnectionId = shop.id;
  });

  it('persists the batch + per-variant children carrying bulkBatchId', async () => {
    const result = await submitService().submit({
      connectionId: shopConnectionId,
      initiatedBy: 'user-int',
      items: [
        { internalVariantId: VARIANT_A, stock: 4 },
        { internalVariantId: VARIANT_B, stock: 4 },
      ],
      status: 'published',
    });

    expect(result.items).toHaveLength(2);

    const summary = await submitService().getBatch(result.batchId);
    expect(summary).not.toBeNull();
    expect(summary?.batch.totalCount).toBe(2);
    expect(summary?.batch.status).toBe('running');
    expect(summary?.records).toHaveLength(2);
    expect(summary?.records.every((r) => r.bulkBatchId === result.batchId)).toBe(true);
    expect(summary?.records.map((r) => r.internalVariantId).sort()).toEqual([VARIANT_A, VARIANT_B]);
  });

  it('has the bulkBatchId column on listing_creation_records (migration applied)', async () => {
    const rows = (await harness.getDataSource().query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_name = 'listing_creation_records' AND column_name = 'bulkBatchId'`,
    )) as { data_type: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].data_type).toBe('uuid');
  });

  it('advances the shared batch counters per child and derives the terminal status', async () => {
    // Mirrors the worker handler's V2 path — one `advanceBatchStatus` per child
    // as each publish terminates. Proves the child-type-agnostic
    // BulkListingProgressService + bulk_batch_advancements aggregate works for
    // shop-publish children (ListingCreationRecord ids) against real Postgres.
    const { batchId, items } = await submitService().submit({
      connectionId: shopConnectionId,
      initiatedBy: 'user-int',
      items: [
        { internalVariantId: VARIANT_A, stock: 1 },
        { internalVariantId: VARIANT_B, stock: 1 },
      ],
      status: 'published',
    });
    const [childA, childB] = items;
    const progress = progressService();

    // First child succeeds — not the final child, so advance returns null. Read
    // the batch back to confirm the counter incremented and it's still running.
    const afterA = await progress.advanceBatchStatus(
      batchId,
      childA.listingCreationRecordId,
      'succeeded',
    );
    expect(afterA).toBeNull();
    const running = await submitService().getBatch(batchId);
    expect(running?.batch.succeededCount).toBe(1);
    expect(running?.batch.status).toBe('running');

    // Second (final) child fails → 1 succeeded + 1 failed === totalCount →
    // terminal; the terminal advance returns the updated batch.
    const afterB = await progress.advanceBatchStatus(
      batchId,
      childB.listingCreationRecordId,
      'failed',
    );
    expect(afterB?.succeededCount).toBe(1);
    expect(afterB?.failedCount).toBe(1);
    expect(afterB?.status).toBe('partially-failed');
  });

  it('dedups a duplicate advance for the same child (at-most-once gate, #1084)', async () => {
    // Real-DB coverage of the duplicate-advance path: a worker retry re-running
    // the same child must NOT double-count. Guards the #1084 fix
    // (markAdvancedIfNotExists deriving `created` from the RETURNING rows).
    const { batchId, items } = await submitService().submit({
      connectionId: shopConnectionId,
      initiatedBy: 'user-int',
      items: [
        { internalVariantId: VARIANT_A, stock: 1 },
        { internalVariantId: VARIANT_B, stock: 1 },
      ],
      status: 'published',
    });
    const [childA] = items;
    const progress = progressService();

    // First advance counts (1 of 2 → not terminal → returns null).
    expect(await progress.advanceBatchStatus(batchId, childA.listingCreationRecordId, 'succeeded')).toBeNull();
    expect((await submitService().getBatch(batchId))?.batch.succeededCount).toBe(1);

    // Re-advancing the SAME child is a no-op (gate dedups). The regression guard
    // is the counter holding at 1 below — before #1084 this double-counted to 2
    // and flipped the batch to `completed`. (The null return alone is not proof:
    // advanceBatchStatus also returns null on the non-terminal branch.)
    expect(await progress.advanceBatchStatus(batchId, childA.listingCreationRecordId, 'succeeded')).toBeNull();
    const afterDup = await submitService().getBatch(batchId);
    expect(afterDup?.batch.succeededCount).toBe(1);
    expect(afterDup?.batch.status).toBe('running');
  });
});
