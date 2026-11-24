/**
 * Inventory propagation: one job per offer (#4100)
 *
 * Two offers mapped to ONE variant must fan out to two distinct
 * `marketplace.offerQuantity.update` requests. The idempotency key now ends
 * `:offer:{externalId}`; the claim that matters is that the real
 * `sync_jobs.idempotencyKey` unique index keeps BOTH rows instead of swallowing
 * the second, which a mock queue cannot show.
 *
 * @module apps/worker/test/integration
 */
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { WorkerIntegrationTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';
import { JOB_ENQUEUE_TOKEN, SYNC_JOB_REPOSITORY_TOKEN } from '@openlinker/core/sync';
import type { JobEnqueuePort, SyncJobRepositoryPort } from '@openlinker/core/sync';
import { InventoryItemOrmEntity } from '@openlinker/core/inventory/orm-entities';
import { ProductOrmEntity, ProductVariantOrmEntity } from '@openlinker/core/products/orm-entities';
import { IdentifierMappingOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

interface EnqueuedJob {
  jobType: string;
  connectionId: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}

describe('Inventory propagation keys one job per offer (#4100)', () => {
  let harness: WorkerIntegrationTestHarness;
  let dataSource: DataSource;
  let jobEnqueue: JobEnqueuePort;
  let jobRepository: SyncJobRepositoryPort;

  beforeAll(async () => {
    harness = await getTestHarness();
    dataSource = harness.getDataSource();
    jobEnqueue = harness.get(JOB_ENQUEUE_TOKEN);
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

  it('should keep two distinct sync_jobs rows for two offers of one variant', async () => {
    const master = await createTestConnection(dataSource, {
      platformType: 'prestashop',
      status: 'active',
    });
    const destination = await createTestConnection(dataSource, {
      platformType: 'allegro',
      status: 'active',
    });
    const suffix = randomUUID().replace(/-/g, '');
    const productId = `ol_product_${suffix}`;
    const variantId = `ol_variant_${suffix}`;
    await dataSource
      .getRepository(ProductOrmEntity)
      .save({ id: productId, name: 'Two offers' } as ProductOrmEntity);
    await dataSource
      .getRepository(ProductVariantOrmEntity)
      .save({ id: variantId, productId, sku: `SKU-${suffix.slice(0, 6)}` } as ProductVariantOrmEntity);
    const mappings = dataSource.getRepository(IdentifierMappingOrmEntity);
    for (const externalId of ['offer-a', 'offer-b']) {
      await mappings.save(
        mappings.create({
          entityType: 'Offer',
          internalId: variantId,
          externalId,
          platformType: 'allegro',
          connectionId: destination.id,
          context: null,
        })
      );
    }
    await dataSource.getRepository(InventoryItemOrmEntity).save(
      dataSource.getRepository(InventoryItemOrmEntity).create({
        id: `ol_inventoryitem_${suffix}`,
        productId,
        productVariantId: variantId,
        availableQuantity: 5,
        reservedQuantity: 0,
        locationId: null,
        isStale: false,
        sourceConnectionId: master.id,
      })
    );

    const captured: EnqueuedJob[] = [];
    jest.spyOn(jobEnqueue, 'enqueueJob').mockImplementation(async (request: unknown) => {
      captured.push(request as EnqueuedJob);
      return { jobId: `captured-${randomUUID()}`, isExisting: false };
    });
    const {
      InventoryPropagateToMarketplacesHandler,
    } = require('../../src/sync/handlers/inventory-propagate-to-marketplaces.handler');
    await harness.get(InventoryPropagateToMarketplacesHandler).execute({
      id: `job-${randomUUID()}`,
      jobType: 'inventory.propagateToMarketplaces',
      connectionId: '',
      payload: { productId, variantId, inventoryUpdatedAt: '2026-01-01T12:00:00.000Z' },
      idempotencyKey: `propagate-${randomUUID()}`,
      status: 'queued',
      attempts: 0,
      maxAttempts: 10,
      nextRunAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      lastError: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const updates = captured.filter((j) => j.jobType === 'marketplace.offerQuantity.update');
    expect(updates).toHaveLength(2);
    const keys = updates.map((j) => j.idempotencyKey);
    expect(new Set(keys).size).toBe(2);
    expect(keys.some((k) => k.endsWith(':offer:offer-a'))).toBe(true);
    expect(keys.some((k) => k.endsWith(':offer:offer-b'))).toBe(true);

    // The real unique index must keep both rows.
    for (const update of updates) {
      await jobRepository.createIfNotExistsByIdempotencyKey({
        jobType: update.jobType as never,
        connectionId: update.connectionId,
        payload: update.payload,
        idempotencyKey: update.idempotencyKey,
        maxAttempts: 10,
      });
    }
    const rows = await dataSource.query(
      `SELECT "idempotencyKey" FROM sync_jobs WHERE "jobType" = 'marketplace.offerQuantity.update'`
    );
    expect(rows).toHaveLength(2);
  });
});
