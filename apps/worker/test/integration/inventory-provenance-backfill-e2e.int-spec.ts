/**
 * Inventory Provenance Backfill End-to-End Integration Test (#2317)
 *
 * ADR-058 ladder step (ii) against a real Postgres + Redis harness. Five claims
 * this file exists to hold, each of which a unit test with a mocked repository
 * structurally cannot:
 *
 * 1. The drain actually terminates, resuming across ticks, and the completion
 *    latch is written exactly once at the end.
 * 2. `updatedAt` is byte-identical before and after. This is the claim the
 *    whole raw-SQL decision rests on, and only a real TypeORM + Postgres round
 *    trip can falsify it - a mocked `query` proves nothing about what the ORM
 *    would have appended.
 * 3. A row that already carries a real connection id is never overwritten by
 *    the sentinel.
 * 4. A later tick past completion is a no-op that does not touch the table.
 * 5. Neither partial unique index is disturbed (the #2314 migration's central
 *    caveat, and #2325's precondition).
 *
 * Worth having as an int-spec for the reason the sibling reconcile spec gives:
 * `pnpm lint` / `pnpm type-check` exclude `apps/worker/test`, so this file is
 * compile-checked only when it runs.
 *
 * @module apps/worker/test/integration
 */
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { WorkerIntegrationTestHarness } from './setup';
import { SYNC_CURSORS_SERVICE_TOKEN, ISyncCursorsService, SyncJobRequest } from '@openlinker/core/sync';
import { SYNC_JOB_REPOSITORY_TOKEN } from '@openlinker/core/sync';
import { InventoryItemOrmEntity } from '@openlinker/core/inventory/orm-entities';
import { ProductOrmEntity, ProductVariantOrmEntity } from '@openlinker/core/products/orm-entities';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

const SYSTEM_ID = '00000000-0000-0000-0000-000000000000';
const COMPLETED_AT_KEY = `master.inventory-provenance.completedAt:connection:${SYSTEM_ID}`;
const REMAINING_KEY = `master.inventory-provenance.remainingNull:connection:${SYSTEM_ID}`;

describe('Inventory Provenance Backfill End-to-End Integration (#2317)', () => {
  let harness: WorkerIntegrationTestHarness;
  let dataSource: DataSource;
  let cursors: ISyncCursorsService;
  // Structurally typed to the one method used, rather than importing
  // `SyncJobRepositoryPort` - a repository port is an intra-context contract
  // and `check-cross-context-imports` denies it by shape (the sibling reconcile
  // spec does the same).
  let jobRepository: {
    createIfNotExistsByIdempotencyKey(input: {
      jobType: string;
      connectionId: string;
      payload: unknown;
      idempotencyKey: string;
      maxAttempts: number;
    }): Promise<unknown>;
  };

  beforeAll(async () => {
    harness = await getTestHarness();
    dataSource = harness.getDataSource();
    cursors = harness.get(SYNC_CURSORS_SERVICE_TOKEN);
    jobRepository = harness.get(SYNC_JOB_REPOSITORY_TOKEN);
  });

  beforeEach(async () => {
    await resetTestHarness();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  /** Seeds `count` inventory rows with NULL provenance, plus their products. */
  async function seedNullProvenanceRows(count: number): Promise<string[]> {
    const productRepo = dataSource.getRepository(ProductOrmEntity);
    const variantRepo = dataSource.getRepository(ProductVariantOrmEntity);
    const inventoryRepo = dataSource.getRepository(InventoryItemOrmEntity);

    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const productId = `ol_product_${randomUUID().replace(/-/g, '')}`;
      const variantId = `ol_variant_${randomUUID().replace(/-/g, '')}`;
      await productRepo.save(productRepo.create({ id: productId, name: `Product ${String(i)}` }));
      await variantRepo.save(variantRepo.create({ id: variantId, productId }));

      const rowId = `ol_inventoryitem_${randomUUID().replace(/-/g, '')}`;
      await inventoryRepo.save(
        inventoryRepo.create({
          id: rowId,
          productId,
          productVariantId: variantId,
          availableQuantity: 10 + i,
          reservedQuantity: 0,
          locationId: null,
          isStale: false,
          // The pre-#2314 state this whole pass exists to repair.
          sourceConnectionId: null,
        })
      );
      ids.push(rowId);
    }
    return ids;
  }

  /** Seeds one row that already names a real connection - the control. */
  async function seedOwnedRow(ownerId: string): Promise<string> {
    const productRepo = dataSource.getRepository(ProductOrmEntity);
    const variantRepo = dataSource.getRepository(ProductVariantOrmEntity);
    const inventoryRepo = dataSource.getRepository(InventoryItemOrmEntity);

    const productId = `ol_product_${randomUUID().replace(/-/g, '')}`;
    const variantId = `ol_variant_${randomUUID().replace(/-/g, '')}`;
    await productRepo.save(productRepo.create({ id: productId, name: 'Owned product' }));
    await variantRepo.save(variantRepo.create({ id: variantId, productId }));

    const rowId = `ol_inventoryitem_${randomUUID().replace(/-/g, '')}`;
    await inventoryRepo.save(
      inventoryRepo.create({
        id: rowId,
        productId,
        productVariantId: variantId,
        availableQuantity: 99,
        reservedQuantity: 0,
        locationId: null,
        isStale: false,
        sourceConnectionId: ownerId,
      })
    );
    return rowId;
  }

  async function runBackfill(payload: Record<string, unknown> = {}): Promise<void> {
    const request: SyncJobRequest = {
      jobType: 'inventory.provenance.backfill',
      connectionId: SYSTEM_ID,
      payload: { schemaVersion: 1, ...payload },
      idempotencyKey: `inventory-provenance-backfill-${randomUUID()}`,
    };
    const job = await jobRepository.createIfNotExistsByIdempotencyKey({
      jobType: request.jobType,
      connectionId: request.connectionId,
      payload: request.payload,
      idempotencyKey: request.idempotencyKey,
      maxAttempts: 3,
    });

    const {
      InventoryProvenanceBackfillHandler,
    } = require('../../src/sync/handlers/inventory-provenance-backfill.handler');
    const handler = harness.get(InventoryProvenanceBackfillHandler);
    await handler.execute(job);
  }

  async function readRows(ids: string[]): Promise<InventoryItemOrmEntity[]> {
    const repo = dataSource.getRepository(InventoryItemOrmEntity);
    const rows = await repo.findByIds(ids);
    return rows.sort((a, b) => a.id.localeCompare(b.id));
  }

  it('drains across ticks, reports remaining after each, and latches on completion', async () => {
    const ids = await seedNullProvenanceRows(12);

    // Tick 1 of 3.
    await runBackfill({ pageLimit: 5 });
    expect(await cursors.getCursor(SYSTEM_ID, REMAINING_KEY)).toBe('7');
    // Not complete yet - the latch must stay unset or every later tick
    // short-circuits over rows that are still NULL.
    expect((await cursors.getCursor(SYSTEM_ID, COMPLETED_AT_KEY)) ?? '').toBe('');

    // Tick 2 of 3.
    await runBackfill({ pageLimit: 5 });
    expect(await cursors.getCursor(SYSTEM_ID, REMAINING_KEY)).toBe('2');
    expect((await cursors.getCursor(SYSTEM_ID, COMPLETED_AT_KEY)) ?? '').toBe('');

    // Tick 3 of 3 - the completing page carries only the 2 stragglers.
    await runBackfill({ pageLimit: 5 });
    expect(await cursors.getCursor(SYSTEM_ID, REMAINING_KEY)).toBe('0');
    expect(await cursors.getCursor(SYSTEM_ID, COMPLETED_AT_KEY)).toEqual(
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
    );

    const rows = await readRows(ids);
    expect(rows).toHaveLength(12);
    expect(rows.every((row) => row.sourceConnectionId === 'legacy')).toBe(true);
  });

  it('never persists a sweep-offset cursor, because the predicate is the cursor', async () => {
    await seedNullProvenanceRows(3);
    await runBackfill({ pageLimit: 2 });

    // An offset advancing over a self-consuming set steps over rows. Nothing
    // in this family's offset namespace may ever be written by this pass.
    expect(
      (await cursors.getCursor(
        SYSTEM_ID,
        `master.inventory-provenance.sweep:connection:${SYSTEM_ID}`
      )) ?? ''
    ).toBe('');
  });

  it('leaves updatedAt byte-identical - the claim the raw SQL exists for', async () => {
    const ids = await seedNullProvenanceRows(4);
    const before = await readRows(ids);
    const beforeStamps = before.map((row) => row.updatedAt.toISOString());

    // A real gap, so a bumped timestamp could not coincidentally match.
    await new Promise((resolve) => setTimeout(resolve, 25));

    await runBackfill({ pageLimit: 10 });

    const after = await readRows(ids);
    expect(after.map((row) => row.updatedAt.toISOString())).toEqual(beforeStamps);
    // ...and the stamp really did happen, so the assertion above is not vacuous.
    expect(after.every((row) => row.sourceConnectionId === 'legacy')).toBe(true);
    // Stock is untouched too - this pass writes exactly one column.
    expect(after.map((row) => row.availableQuantity)).toEqual(
      before.map((row) => row.availableQuantity)
    );
  });

  it('never overwrites a row that already names a real connection', async () => {
    const ownerId = randomUUID();
    const ownedId = await seedOwnedRow(ownerId);
    await seedNullProvenanceRows(3);

    await runBackfill({ pageLimit: 50 });

    const [owned] = await readRows([ownedId]);
    // The sentinel means "owner unknown". It may only ever LOSE to a real id.
    expect(owned.sourceConnectionId).toBe(ownerId);
    expect(await cursors.getCursor(SYSTEM_ID, REMAINING_KEY)).toBe('0');
  });

  it('short-circuits a tick past completion without touching the table', async () => {
    const ids = await seedNullProvenanceRows(2);
    await runBackfill({ pageLimit: 50 });
    const completedAt = await cursors.getCursor(SYSTEM_ID, COMPLETED_AT_KEY);
    expect(completedAt).not.toBeNull();

    // A row that arrives after the latch is deliberately NOT collected: the
    // pass is a one-time drain, and #2325 re-counts before it acts.
    const laterIds = await seedNullProvenanceRows(1);

    await runBackfill({ pageLimit: 50 });

    // The latch is unchanged - not re-stamped - and the late row is untouched.
    expect(await cursors.getCursor(SYSTEM_ID, COMPLETED_AT_KEY)).toBe(completedAt);
    const [late] = await readRows(laterIds);
    expect(late.sourceConnectionId).toBeNull();
    const drained = await readRows(ids);
    expect(drained.every((row) => row.sourceConnectionId === 'legacy')).toBe(true);
  });

  it('re-arms when the completion cursor is deleted, and re-running is idempotent', async () => {
    const ids = await seedNullProvenanceRows(2);
    await runBackfill({ pageLimit: 50 });

    // The documented operator escape hatch. Safe at any time, because the
    // predicate is IS NULL and a re-run over a stamped table is a no-op.
    await cursors.advanceCursor(SYSTEM_ID, COMPLETED_AT_KEY, '');

    await runBackfill({ pageLimit: 50 });

    const rows = await readRows(ids);
    expect(rows.every((row) => row.sourceConnectionId === 'legacy')).toBe(true);
    expect(await cursors.getCursor(SYSTEM_ID, REMAINING_KEY)).toBe('0');
  });

  it('leaves both partial unique indexes exactly as the #2314 migration left them', async () => {
    await seedNullProvenanceRows(2);
    const indexesBefore = await dataSource.query(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE tablename = 'inventory_items' ORDER BY indexname`
    );

    await runBackfill({ pageLimit: 50 });

    const indexesAfter = await dataSource.query(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE tablename = 'inventory_items' ORDER BY indexname`
    );
    // Index work belongs to #2325, which can only run once this drain leaves
    // no NULLs behind. This pass must not anticipate it.
    expect(indexesAfter).toEqual(indexesBefore);
  });
});
