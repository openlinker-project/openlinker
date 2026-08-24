/**
 * Inventory Location Propagation End-to-End Integration Test (#2324)
 *
 * ADR-058 decision (5) against a real Postgres + Redis harness. The claim this
 * file exists to hold is the one a unit test with a mocked repository
 * structurally cannot: that the number a located master's stock publishes with
 * is the SUM of the variant's live positions, read back out of the real table
 * through the real availability seam.
 *
 * Five things are asserted:
 *
 * 1. Two located positions (6 + 4) produce exactly ONE offer-quantity update,
 *    for 10 - the aggregate, not either row and not two publishes.
 * 2. The #2322 transition: a staled pooled row (10) coexisting with the located
 *    rows that replaced it (6 + 4) publishes 10, not 20 - a staled position is
 *    not stock.
 * 3. The staling itself triggers propagation (#2324's Q5 arm): a master that
 *    starts locating stales its own pooled row, which changes the aggregate
 *    while writing NO inventory row - so this enqueue is the only thing that
 *    carries the correction to the channel, and the staled variant publishes
 *    the reduced (here: known-zero) aggregate.
 * 4. Cross-source guard: two sources' pooled positions for one variant SUM
 *    (ADR-058 decision 2) - deduplicating them is #2319/#2325's problem, not
 *    this seam's, and a silent change here would move published numbers on a
 *    healthy multi-source install.
 * 5. Byte-identity control: a single-source, locationless install publishes the
 *    same number it published before #2324.
 *
 * Worth having as an int-spec for the reason its siblings give: `pnpm lint` /
 * `pnpm type-check` exclude `apps/worker/test`, so this file is compile-checked
 * only when it runs.
 *
 * @module apps/worker/test/integration
 */
import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import { WorkerIntegrationTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';
import {
  JOB_ENQUEUE_TOKEN,
  JobEnqueuePort,
  SYNC_JOB_QUEUE_TOKEN,
  SyncJobQueuePort,
} from '@openlinker/core/sync';
import { INTEGRATIONS_SERVICE_TOKEN, IIntegrationsService } from '@openlinker/core/integrations';
import type { InventoryMasterPort } from '@openlinker/core/inventory';
import { MASTER_INVENTORY_SYNC_SERVICE_TOKEN } from '@openlinker/core/inventory';
import { InventoryItemOrmEntity } from '@openlinker/core/inventory/orm-entities';
import { ProductOrmEntity, ProductVariantOrmEntity } from '@openlinker/core/products/orm-entities';
import { IdentifierMappingOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';

interface SeededVariant {
  productId: string;
  variantId: string;
  externalId: string;
}

interface EnqueuedJob {
  jobType: string;
  connectionId: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
}

describe('Inventory Location Propagation End-to-End Integration (#2324)', () => {
  let harness: WorkerIntegrationTestHarness;
  let dataSource: DataSource;
  let integrationsService: IIntegrationsService;
  let jobEnqueue: JobEnqueuePort;
  let jobQueue: SyncJobQueuePort;

  beforeAll(async () => {
    harness = await getTestHarness();
    dataSource = harness.getDataSource();
    integrationsService = harness.get(INTEGRATIONS_SERVICE_TOKEN);
    jobEnqueue = harness.get(JOB_ENQUEUE_TOKEN);
    jobQueue = harness.get(SYNC_JOB_QUEUE_TOKEN);
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

  /** Seeds a product + one variant + its `Product` identifier mapping. */
  async function seedVariant(connectionId: string): Promise<SeededVariant> {
    const suffix = randomUUID().replace(/-/g, '');
    const productId = `ol_product_${suffix}`;
    const variantId = `ol_variant_${suffix}`;
    const externalId = `ext-${suffix.slice(0, 8)}`;

    const mappingRepo = dataSource.getRepository(IdentifierMappingOrmEntity);
    await mappingRepo.save(
      mappingRepo.create({
        entityType: 'Product',
        internalId: productId,
        externalId,
        platformType: 'prestashop',
        connectionId,
        context: null,
      })
    );

    const productRepo = dataSource.getRepository(ProductOrmEntity);
    await productRepo.save(productRepo.create({ id: productId, name: 'Located' }));

    const variantRepo = dataSource.getRepository(ProductVariantOrmEntity);
    await variantRepo.save(
      variantRepo.create({ id: variantId, productId, sku: `SKU-${suffix.slice(0, 6)}` })
    );

    return { productId, variantId, externalId };
  }

  /** Seeds one `inventory_items` position. */
  async function seedPosition(input: {
    productId: string;
    variantId: string | null;
    quantity: number;
    locationId: string | null;
    sourceConnectionId: string | null;
    isStale?: boolean;
  }): Promise<void> {
    const repo = dataSource.getRepository(InventoryItemOrmEntity);
    await repo.save(
      repo.create({
        id: `ol_inventoryitem_${randomUUID().replace(/-/g, '')}`,
        productId: input.productId,
        productVariantId: input.variantId,
        availableQuantity: input.quantity,
        reservedQuantity: 0,
        locationId: input.locationId,
        isStale: input.isStale ?? false,
        sourceConnectionId: input.sourceConnectionId,
      })
    );
  }

  /** Maps the variant to one marketplace offer, so the fan-out has a target. */
  async function seedOfferMapping(variantId: string, connectionId: string): Promise<string> {
    const externalOfferId = `offer-${randomUUID().slice(0, 8)}`;
    const mappingRepo = dataSource.getRepository(IdentifierMappingOrmEntity);
    await mappingRepo.save(
      mappingRepo.create({
        entityType: 'Offer',
        internalId: variantId,
        externalId: externalOfferId,
        platformType: 'allegro',
        connectionId,
        context: null,
      })
    );
    return externalOfferId;
  }

  /**
   * Captures every downstream enqueue rather than draining the queue: the claim
   * under test is the QUANTITY the handler decided to publish and how many
   * publishes it produced, both of which are fully expressed in the request.
   */
  function captureEnqueues(): EnqueuedJob[] {
    const captured: EnqueuedJob[] = [];
    jest.spyOn(jobEnqueue, 'enqueueJob').mockImplementation(async (request: unknown) => {
      captured.push(request as EnqueuedJob);
      return { jobId: `captured-${randomUUID()}`, isExisting: false };
    });
    return captured;
  }

  function getPropagateHandler(): { execute(job: unknown): Promise<{ outcome: string }> } {
    const {
      InventoryPropagateToMarketplacesHandler,
    } = require('../../src/sync/handlers/inventory-propagate-to-marketplaces.handler');
    return harness.get(InventoryPropagateToMarketplacesHandler);
  }

  function propagateJob(productId: string, variantId: string | null): unknown {
    return {
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
    };
  }

  function quantitiesOf(captured: EnqueuedJob[]): number[] {
    return captured
      .filter((j) => j.jobType === 'marketplace.offerQuantity.update')
      .map((j) => j.payload.quantity as number);
  }

  it('publishes the SUM of two located positions as one update (6 + 4 = 10)', async () => {
    const master = await createTestConnection(dataSource, {
      platformType: 'prestashop',
      status: 'active',
    });
    const destination = await createTestConnection(dataSource, {
      platformType: 'allegro',
      status: 'active',
    });
    const { productId, variantId } = await seedVariant(master.id);
    await seedOfferMapping(variantId, destination.id);

    await seedPosition({
      productId,
      variantId,
      quantity: 6,
      locationId: 'warehouse-a',
      sourceConnectionId: master.id,
    });
    await seedPosition({
      productId,
      variantId,
      quantity: 4,
      locationId: 'warehouse-b',
      sourceConnectionId: master.id,
    });

    const captured = captureEnqueues();
    const result = await getPropagateHandler().execute(propagateJob(productId, variantId));

    expect(result.outcome).toBe('ok');
    // ONE publish, for the aggregate - not one per location, and not 6 or 4.
    expect(quantitiesOf(captured)).toEqual([10]);
  });

  it('excludes a staled pooled row and publishes only the located aggregate (#2322 transition)', async () => {
    const master = await createTestConnection(dataSource, {
      platformType: 'prestashop',
      status: 'active',
    });
    const destination = await createTestConnection(dataSource, {
      platformType: 'allegro',
      status: 'active',
    });
    const { productId, variantId } = await seedVariant(master.id);
    await seedOfferMapping(variantId, destination.id);

    // The pre-transition pooled position, staled by #2322 when the master
    // started locating. It must contribute NOTHING.
    await seedPosition({
      productId,
      variantId,
      quantity: 10,
      locationId: null,
      sourceConnectionId: master.id,
      isStale: true,
    });
    await seedPosition({
      productId,
      variantId,
      quantity: 6,
      locationId: 'warehouse-a',
      sourceConnectionId: master.id,
    });
    await seedPosition({
      productId,
      variantId,
      quantity: 4,
      locationId: 'warehouse-b',
      sourceConnectionId: master.id,
    });

    const captured = captureEnqueues();
    await getPropagateHandler().execute(propagateJob(productId, variantId));

    // 10, never 20 - a staled position is not stock.
    expect(quantitiesOf(captured)).toEqual([10]);
  });

  it('enqueues propagation when a master starts locating, and publishes the reduced aggregate', async () => {
    const master = await createTestConnection(dataSource, {
      platformType: 'prestashop',
      status: 'active',
    });
    const destination = await createTestConnection(dataSource, {
      platformType: 'allegro',
      status: 'active',
    });
    const { productId, variantId, externalId } = await seedVariant(master.id);
    await seedOfferMapping(variantId, destination.id);

    // Yesterday's pooled position, still live.
    await seedPosition({
      productId,
      variantId,
      quantity: 10,
      locationId: null,
      sourceConnectionId: master.id,
    });

    // The master now reports the same variant as two LOCATED positions. #2322
    // stales the pooled row; #2324 is what makes that staling propagate.
    jest.spyOn(integrationsService, 'getCapabilityAdapter').mockResolvedValue({
      listInventory: jest.fn().mockResolvedValue([
        {
          productId: externalId,
          productVariantId: variantId,
          availableQuantity: 6,
          reservedQuantity: 0,
          locationId: 'warehouse-a',
        },
        {
          productId: externalId,
          productVariantId: variantId,
          availableQuantity: 4,
          reservedQuantity: 0,
          locationId: 'warehouse-b',
        },
      ]),
      getInventory: jest.fn(),
      adjustInventory: jest.fn(),
      reserveInventory: jest.fn(),
      releaseInventory: jest.fn(),
      getAvailableQuantity: jest.fn(),
    } as unknown as InventoryMasterPort);

    const masterSync = harness.get(MASTER_INVENTORY_SYNC_SERVICE_TOKEN) as {
      syncFromMasterByExternalId(
        connectionId: string,
        externalId: string
      ): Promise<{ pooledPositionsStaled: number }>;
    };

    // The staling writes no inventory row, so THIS enqueue is the only thing
    // that would carry the aggregate change to the marketplace.
    const queued: { type: string; payload: Record<string, unknown> }[] = [];
    const realEnqueue = jobQueue.enqueue.bind(jobQueue);
    jest.spyOn(jobQueue, 'enqueue').mockImplementation(async (request) => {
      queued.push(request as unknown as { type: string; payload: Record<string, unknown> });
      return realEnqueue(request);
    });

    const syncResult = await masterSync.syncFromMasterByExternalId(master.id, externalId);
    expect(syncResult.pooledPositionsStaled).toBeGreaterThan(0);

    expect(
      queued.filter(
        (j) =>
          j.type === 'inventory.propagateToMarketplaces' && j.payload.variantId === variantId
      ).length
    ).toBeGreaterThan(0);

    // The pooled position is gone, so the variant it belonged to now publishes
    // a known ZERO - which is exactly the correction the enqueue exists to
    // deliver, and the number the channel would never have received before
    // #2324 (the staling writes no row, so nothing else would have fired).
    const pooledCaptured = captureEnqueues();
    await getPropagateHandler().execute(propagateJob(productId, variantId));
    expect(quantitiesOf(pooledCaptured)).toEqual([0]);
    jest.restoreAllMocks();

    // That the LOCATED positions the master just wrote publish as their sum is
    // the first test's claim, asserted there against seeded rows; repeating it
    // through the sync would additionally assert how the sync resolves its own
    // internal variant ids, which is #2320's subject, not this one's.
  });

  it('SUMS two sources pooled positions for one variant (ADR-058 decision 2)', async () => {
    const sourceA = await createTestConnection(dataSource, {
      platformType: 'prestashop',
      status: 'active',
    });
    const sourceB = await createTestConnection(dataSource, {
      platformType: 'woocommerce',
      status: 'active',
    });
    const destination = await createTestConnection(dataSource, {
      platformType: 'allegro',
      status: 'active',
    });
    const { productId, variantId } = await seedVariant(sourceA.id);
    await seedOfferMapping(variantId, destination.id);

    await seedPosition({
      productId,
      variantId,
      quantity: 3,
      locationId: null,
      sourceConnectionId: sourceA.id,
    });
    await seedPosition({
      productId,
      variantId,
      quantity: 5,
      locationId: null,
      sourceConnectionId: sourceB.id,
    });

    const captured = captureEnqueues();
    await getPropagateHandler().execute(propagateJob(productId, variantId));

    expect(quantitiesOf(captured)).toEqual([8]);
  });

  it('publishes an unchanged number on a single-source, locationless install (byte-identity control)', async () => {
    const master = await createTestConnection(dataSource, {
      platformType: 'prestashop',
      status: 'active',
    });
    const destination = await createTestConnection(dataSource, {
      platformType: 'allegro',
      status: 'active',
    });
    const { productId, variantId } = await seedVariant(master.id);
    await seedOfferMapping(variantId, destination.id);

    await seedPosition({
      productId,
      variantId,
      quantity: 42,
      locationId: null,
      sourceConnectionId: master.id,
    });

    const captured = captureEnqueues();
    await getPropagateHandler().execute(propagateJob(productId, variantId));

    expect(quantitiesOf(captured)).toEqual([42]);
  });
});
