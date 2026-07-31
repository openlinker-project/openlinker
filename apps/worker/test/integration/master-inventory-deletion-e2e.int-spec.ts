/**
 * Master Inventory Deletion End-to-End Integration Test (#1688)
 *
 * Vertical slice for the master-side deletion path, which unit tests cannot
 * reach end-to-end because it spans an adapter-thrown neutral error, a bulk
 * Postgres mutation, a Redis stream publish, and the ADR-007 outcome wiring:
 *
 * 1. `InventoryMasterPort.listInventory` throws the neutral
 *    `MasterProductNotFoundError` (what both adapters translate their platform
 *    not-found into at the port boundary).
 * 2. Every one of the product's `inventory_items` rows is marked stale in real
 *    Postgres (empty keep-set prune).
 * 3. `master.product.stale` lands on the `events.master.deletion` Redis stream
 *    carrying the internal product id.
 * 4. The handler reports `outcome: 'business_failure'`, and persisting it flips
 *    the job to `succeeded` with that outcome so the runner never retries a
 *    permanent condition (ADR-007).
 *
 * A transient adapter failure is covered as the negative control: it rethrows,
 * leaves every row live, and publishes nothing.
 *
 * Uses real Postgres + Redis via Testcontainers.
 *
 * @module apps/worker/test/integration
 */
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import {
  getTestHarness,
  resetTestHarness,
  teardownTestHarness,
  WorkerIntegrationTestHarness,
} from './setup';
import { createTestConnection } from './helpers/test-connection.helper';
import { getSyncJobById } from './helpers/test-sync-job.helper';
import {
  SYNC_JOB_REPOSITORY_TOKEN,
  SyncJobEntity,
  SyncJobHandlerResult,
  JobOutcome,
} from '@openlinker/core/sync';
import { INTEGRATIONS_SERVICE_TOKEN, IIntegrationsService } from '@openlinker/core/integrations';
import {
  MasterProductNotFoundError,
  MASTER_DELETION_EVENT_STREAM,
  MASTER_PRODUCT_STALE_EVENT,
  type MasterDeletionEventPayload,
} from '@openlinker/core/products';
import {
  ProductOrmEntity,
  ProductVariantOrmEntity,
} from '@openlinker/core/products/orm-entities';
import { InventoryItemOrmEntity } from '@openlinker/core/inventory/orm-entities';
import { IdentifierMappingOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';
import type { InventoryMasterPort } from '@openlinker/core/inventory';

interface SeededProduct {
  internalProductId: string;
  variantId: string;
  externalId: string;
}

/**
 * Narrow structural view of the job repository — the two methods this slice
 * drives. Declared locally rather than importing `SyncJobRepositoryPort`, which
 * is an intra-context contract (`check-cross-context-imports` deny shape).
 */
interface JobRepositoryView {
  createIfNotExistsByIdempotencyKey(job: {
    jobType: string;
    connectionId: string;
    payload: Record<string, unknown>;
    idempotencyKey: string;
    maxAttempts: number;
  }): Promise<SyncJobEntity>;
  markSucceeded(id: string, outcome: JobOutcome): Promise<void>;
}

describe('Master Inventory Deletion End-to-End Integration (#1688)', () => {
  let harness: WorkerIntegrationTestHarness;
  let jobRepository: JobRepositoryView;
  let integrationsService: IIntegrationsService;
  let dataSource: DataSource;

  beforeAll(async () => {
    harness = await getTestHarness();
    jobRepository = harness.get(SYNC_JOB_REPOSITORY_TOKEN);
    integrationsService = harness.get(INTEGRATIONS_SERVICE_TOKEN);
    dataSource = harness.getDataSource();
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

  /**
   * Seeds a previously-synced product: its identifier mapping (so the sync
   * resolves the same internal id the rows are keyed to), a variant, and one
   * live variant-keyed inventory row.
   */
  async function seedSyncedProduct(connectionId: string): Promise<SeededProduct> {
    const suffix = randomUUID().replace(/-/g, '');
    const internalProductId = `ol_product_${suffix}`;
    const variantId = `ol_variant_${suffix}`;
    const externalId = `ext-${suffix.slice(0, 8)}`;

    const mappingRepo = dataSource.getRepository(IdentifierMappingOrmEntity);
    await mappingRepo.save(
      mappingRepo.create({
        entityType: 'Product',
        internalId: internalProductId,
        externalId,
        platformType: 'prestashop',
        connectionId,
        context: null,
      })
    );

    const productRepo = dataSource.getRepository(ProductOrmEntity);
    await productRepo.save(
      productRepo.create({
        id: internalProductId,
        name: 'Deleted At Master',
        sku: 'DEL-SKU-001',
        price: null,
      })
    );

    const variantRepo = dataSource.getRepository(ProductVariantOrmEntity);
    await variantRepo.save(
      variantRepo.create({
        id: variantId,
        productId: internalProductId,
        sku: 'DEL-SKU-001-V',
        attributes: null,
        ean: null,
        gtin: null,
      })
    );

    const inventoryRepo = dataSource.getRepository(InventoryItemOrmEntity);
    await inventoryRepo.save(
      inventoryRepo.create({
        id: `ol_inventory_${suffix}`,
        productId: internalProductId,
        productVariantId: variantId,
        availableQuantity: 7,
        reservedQuantity: 0,
        locationId: null,
        isStale: false,
      })
    );

    return { internalProductId, variantId, externalId };
  }

  async function createInventoryJob(
    connectionId: string,
    externalId: string
  ): Promise<SyncJobEntity> {
    return jobRepository.createIfNotExistsByIdempotencyKey({
      jobType: 'master.inventory.syncByExternalId',
      connectionId,
      payload: { schemaVersion: 1, externalId, objectType: 'Inventory' },
      idempotencyKey: `inventory-deletion-${randomUUID()}`,
      maxAttempts: 3,
    });
  }

  function stubInventoryAdapter(listInventory: jest.Mock): void {
    jest.spyOn(integrationsService, 'getCapabilityAdapter').mockResolvedValue({
      listInventory,
      getInventory: jest.fn(),
      adjustInventory: jest.fn(),
      reserveInventory: jest.fn(),
      releaseInventory: jest.fn(),
      getAvailableQuantity: jest.fn(),
    } as unknown as InventoryMasterPort);
  }

  function getHandler(): { execute(job: SyncJobEntity): Promise<SyncJobHandlerResult> } {
    const {
      MasterInventorySyncHandler,
    } = require('../../src/sync/handlers/master-inventory-sync.handler');
    return harness.get(MasterInventorySyncHandler);
  }

  async function readDeletionEvents(): Promise<Record<string, string>[]> {
    const redis = harness.getRedisClient();
    if (!redis) {
      throw new Error('Redis client not available on the harness');
    }
    const entries = await redis.xRange(MASTER_DELETION_EVENT_STREAM, '-', '+');
    return entries.map((entry) => entry.message as Record<string, string>);
  }

  it('stales every inventory row, emits master.product.stale, and terminalises the job as business_failure', async () => {
    const connection = await createTestConnection(dataSource, {
      platformType: 'prestashop',
      status: 'active',
      credentialsRef: 'test-credentials-ref',
      adapterKey: 'prestashop.webservice.v1',
    });
    const seeded = await seedSyncedProduct(connection.id);

    // The adapters translate their platform not-found into this neutral error at
    // the port boundary; core only ever sees the neutral type.
    stubInventoryAdapter(
      jest
        .fn()
        .mockRejectedValue(
          new MasterProductNotFoundError(
            seeded.internalProductId,
            connection.id,
            new Error('404 Not Found')
          )
        )
    );

    const job = await createInventoryJob(connection.id, seeded.externalId);

    await expect(getHandler().execute(job)).resolves.toEqual({ outcome: 'business_failure' });

    const inventoryRepo = dataSource.getRepository(InventoryItemOrmEntity);
    const rows = await inventoryRepo.find({ where: { productId: seeded.internalProductId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].isStale).toBe(true);
    // The deletion path never writes quantities — the last-known numbers stay
    // put, the row is only soft-marked.
    expect(rows[0].availableQuantity).toBe(7);

    const events = await readDeletionEvents();
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe(MASTER_PRODUCT_STALE_EVENT);
    const payload = JSON.parse(events[0].payloadJson) as MasterDeletionEventPayload;
    expect(payload).toEqual({
      connectionId: connection.id,
      internalProductId: seeded.internalProductId,
      variantIds: [seeded.variantId],
      correlationId: expect.any(String),
      externalId: seeded.externalId,
    });

    // The runner persists the handler's outcome atomically with the status flip:
    // succeeded + business_failure is terminal, so the job is never retried.
    await jobRepository.markSucceeded(job.id, 'business_failure');
    const persisted = await getSyncJobById(dataSource, job.id);
    expect(persisted?.status).toBe('succeeded');
    expect(persisted?.outcome).toBe('business_failure');
  });

  it('leaves rows live and publishes nothing when the master fails transiently', async () => {
    const connection = await createTestConnection(dataSource, {
      platformType: 'prestashop',
      status: 'active',
      credentialsRef: 'test-credentials-ref',
      adapterKey: 'prestashop.webservice.v1',
    });
    const seeded = await seedSyncedProduct(connection.id);

    stubInventoryAdapter(jest.fn().mockRejectedValue(new Error('503 Service Unavailable')));

    const job = await createInventoryJob(connection.id, seeded.externalId);

    await expect(getHandler().execute(job)).rejects.toThrow(/503 Service Unavailable/);

    const inventoryRepo = dataSource.getRepository(InventoryItemOrmEntity);
    const rows = await inventoryRepo.find({ where: { productId: seeded.internalProductId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].isStale).toBe(false);

    expect(await readDeletionEvents()).toHaveLength(0);
  });
});
