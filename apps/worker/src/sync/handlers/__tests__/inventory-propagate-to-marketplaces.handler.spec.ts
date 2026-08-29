/**
 * Inventory Propagate to Marketplaces Handler Tests
 *
 * Unit tests for InventoryPropagateToMarketplacesHandler. Tests inventory
 * propagation, offer mapping lookup, and job enqueueing.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import { InventoryPropagateToMarketplacesHandler } from '../inventory-propagate-to-marketplaces.handler';
import type { IIdentifierMappingService, ExternalIdMapping } from '@openlinker/core/identifier-mapping';
import type { IInventoryService, IAvailabilityService } from '@openlinker/core/inventory';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { JobEnqueuePort } from '@openlinker/core/sync';
import type { SyncJobEntity as SyncJob } from '@openlinker/core/sync';
import { InventoryItemEntity } from '@openlinker/core/inventory';
import { SyncJobExecutionError } from '@openlinker/core/sync';
import type { IProductsService } from '@openlinker/core/products';

/**
 * Build a lazy `listCapabilityAdapters` entry for the ShopProduct fan-out
 * eligibility set (#1498) — the handler reads only `connectionId` and
 * `connection.enabledCapabilities`.
 */
const makeWriteBackTarget = (
  connectionId: string,
  enabledCapabilities: string[]
): { connectionId: string; connection: { enabledCapabilities: string[] } } => ({
  connectionId,
  connection: { enabledCapabilities },
});

describe('InventoryPropagateToMarketplacesHandler', () => {
  let handler: InventoryPropagateToMarketplacesHandler;
  let identifierMapping: jest.Mocked<IIdentifierMappingService>;
  let inventoryService: jest.Mocked<IInventoryService>;
  let jobEnqueue: jest.Mocked<JobEnqueuePort>;
  let integrationsService: jest.Mocked<IIntegrationsService>;
  let productsService: jest.Mocked<Pick<IProductsService, 'getVariant'>>;
  let availabilityService: jest.Mocked<IAvailabilityService>;

  /**
   * #2324 — the variant-keyed path now reads the AGGREGATE through the
   * availability seam. Helper mirrors the seam's contract: a real number with
   * `provenance: 'computed'`, or the batch-wide `'unknown'` answer.
   */
  const mockAvailability = (
    quantity: number | null,
    provenance: 'computed' | 'authority' | 'unknown' = quantity === null ? 'unknown' : 'computed',
    observedAt: Date | null = quantity === null ? null : new Date('2026-01-01T09:00:00.000Z')
  ): void => {
    availabilityService.getPromisableQuantities.mockImplementation((input) =>
      Promise.resolve(
        input.variantIds.map((productVariantId) => ({
          productVariantId,
          quantity,
          provenance,
          observedAt,
          stalenessMs: observedAt === null ? null : 0,
          // #2345: the computed path reflects its holds inside `quantity`.
          olHeldNotReflected: null,
        }))
      )
    );
  };

  /** Route getExternalIds by entityType so the two fan-out branches are independent. */
  const mockMappings = (byEntityType: Partial<Record<string, ExternalIdMapping[]>>): void => {
    identifierMapping.getExternalIds.mockImplementation((entityType: string) =>
      Promise.resolve(byEntityType[entityType] ?? [])
    );
  };

  beforeEach(() => {
    identifierMapping = {
      getOrCreateInternalId: jest.fn(),
      getInternalId: jest.fn(),
      getExternalIds: jest.fn().mockResolvedValue([]),
      createMapping: jest.fn(),
      batchGetOrCreateInternalIds: jest.fn(),
      getOrCreateExactMapping: jest.fn(),
      deleteMapping: jest.fn(),
    } as unknown as jest.Mocked<IIdentifierMappingService>;

    inventoryService = {
      setInventory: jest.fn(),
      getInventory: jest.fn(),
    } as unknown as jest.Mocked<IInventoryService>;

    jobEnqueue = {
      enqueueJob: jest.fn(),
    } as unknown as jest.Mocked<JobEnqueuePort>;

    integrationsService = {
      listCapabilityAdapters: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<IIntegrationsService>;

    productsService = {
      getVariant: jest.fn().mockResolvedValue(null),
    };

    availabilityService = {
      getPromisableQuantities: jest.fn(),
      applyPublishControls: jest.fn(),
      getAppliedReserve: jest.fn(),
    } as unknown as jest.Mocked<IAvailabilityService>;
    mockAvailability(100);

    handler = new InventoryPropagateToMarketplacesHandler(
      identifierMapping,
      inventoryService,
      jobEnqueue,
      integrationsService,
      productsService as unknown as IProductsService,
      availabilityService
    );
  });

  describe('execute', () => {
    const createJob = (payload: {
      productId: string;
      variantId?: string | null;
      inventoryUpdatedAt?: string | null;
    }): SyncJob => ({
      id: 'job-id',
      jobType: 'inventory.propagateToMarketplaces',
      connectionId: '', // Empty for inventory propagation jobs
      payload: payload as unknown as Record<string, unknown>,
      idempotencyKey: 'key',
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

    it('should propagate inventory to Allegro offers', async () => {
      const job = createJob({ productId: 'product-id' });
      const inventory = new InventoryItemEntity(
        'inventory-id',
        'product-id',
        null,
        100,
        0,
        null,
        new Date()
      );

      inventoryService.getInventory.mockResolvedValue(inventory);
      identifierMapping.getExternalIds.mockResolvedValue([
        {
          entityType: 'Offer',
          platformType: 'allegro',
          connectionId: 'connection-id',
          externalId: 'offer-id',
        },
      ]);
      jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'enqueued-job-id', isExisting: false });

      await handler.execute(job);

      expect(inventoryService.getInventory).toHaveBeenCalledWith('product-id', null, null);
      expect(identifierMapping.getExternalIds).toHaveBeenCalledWith('Offer', 'product-id');
      expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({
          jobType: 'marketplace.offerQuantity.update',
          connectionId: 'connection-id',
          payload: expect.objectContaining({
            schemaVersion: 1,
            offerId: 'offer-id',
            quantity: 100,
          }),
        })
      );
    });

    it('should not enqueue an offer-quantity update when the variant is stale (#1689)', async () => {
      const job = createJob({ productId: 'product-id', variantId: 'variant-id' });
      const inventory = new InventoryItemEntity(
        'inventory-id',
        'product-id',
        'variant-id',
        100,
        0,
        null,
        new Date()
      );

      inventoryService.getInventory.mockResolvedValue(inventory);
      productsService.getVariant.mockResolvedValue({
        id: 'variant-id',
        productId: 'product-id',
        sku: null,
        attributes: null,
        ean: null,
        gtin: null,
        isStale: true,
        staleAt: new Date(),
      });

      await handler.execute(job);

      expect(productsService.getVariant).toHaveBeenCalledWith('variant-id');
      expect(identifierMapping.getExternalIds).not.toHaveBeenCalledWith('Offer', 'variant-id');
      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalledWith(
        expect.objectContaining({ jobType: 'marketplace.offerQuantity.update' })
      );
    });

    it('should skip propagation if no inventory found', async () => {
      const job = createJob({ productId: 'product-id' });
      inventoryService.getInventory.mockResolvedValue(null);

      await handler.execute(job);

      expect(identifierMapping.getExternalIds).not.toHaveBeenCalled();
      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    });

    it('should skip propagation if no mappings found', async () => {
      const job = createJob({ productId: 'product-id' });
      const inventory = new InventoryItemEntity(
        'inventory-id',
        'product-id',
        null,
        100,
        0,
        null,
        new Date()
      );

      inventoryService.getInventory.mockResolvedValue(inventory);
      identifierMapping.getExternalIds.mockResolvedValue([]);

      await handler.execute(job);

      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    });

    it('should enqueue jobs for every offer mapping regardless of platform (#582)', async () => {
      const job = createJob({ productId: 'product-id' });
      const inventory = new InventoryItemEntity(
        'inventory-id',
        'product-id',
        null,
        100,
        0,
        null,
        new Date()
      );
      inventoryService.getInventory.mockResolvedValue(inventory);
      identifierMapping.getExternalIds.mockResolvedValue([
        {
          entityType: 'Offer',
          platformType: 'allegro',
          connectionId: 'allegro-connection',
          externalId: 'allegro-offer',
        },
        {
          entityType: 'Offer',
          platformType: 'amazon',
          connectionId: 'amazon-connection',
          externalId: 'amazon-offer',
        },
      ]);
      jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'enqueued-job-id', isExisting: false });

      await handler.execute(job);

      // Per-platform capability narrowing happens downstream via
      // `IntegrationsService.getCapabilityAdapter`, not here.
      expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(2);
      expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: 'allegro-connection',
          payload: expect.objectContaining({ offerId: 'allegro-offer' }),
        })
      );
      expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: 'amazon-connection',
          payload: expect.objectContaining({ offerId: 'amazon-offer' }),
        })
      );
    });

    // #2324 — the variant-keyed read is the LOCATION-BLIND aggregate from the
    // availability seam, asked in the GLOBAL scope (the channel buffer is
    // applied exactly once downstream by InventorySyncService, #2323).
    it('should read the variant aggregate from the availability seam in the global scope', async () => {
      const job = createJob({ productId: 'product-id', variantId: 'variant-id' });
      mockAvailability(50);
      identifierMapping.getExternalIds.mockResolvedValue([
        {
          entityType: 'Offer',
          platformType: 'allegro',
          connectionId: 'connection-id',
          externalId: 'offer-id',
        },
      ]);
      jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'enqueued-job-id', isExisting: false });

      await handler.execute(job);

      expect(availabilityService.getPromisableQuantities).toHaveBeenCalledWith({
        variantIds: ['variant-id'],
        scope: { kind: 'global' },
      });
      // The single-row, location-scoped read is gone from the variant path.
      expect(inventoryService.getInventory).not.toHaveBeenCalled();
      expect(identifierMapping.getExternalIds).toHaveBeenCalledWith('Offer', 'variant-id');
      expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            quantity: 50,
          }),
        })
      );
    });

    it('should throw and enqueue nothing on either branch when availability is unknown', async () => {
      const job = createJob({ productId: 'product-id', variantId: 'variant-id' });
      mockAvailability(null);
      mockMappings({
        Offer: [
          {
            entityType: 'Offer',
            platformType: 'allegro',
            connectionId: 'connection-id',
            externalId: 'offer-id',
          },
        ],
        ShopProduct: [
          {
            entityType: 'ShopProduct',
            platformType: 'woocommerce',
            connectionId: 'wc-connection',
            externalId: '123',
          },
        ],
      });
      const errorSpy = jest.spyOn(
        (handler as unknown as { logger: { error: (m: string) => void } }).logger,
        'error'
      );

      await expect(handler.execute(job)).rejects.toThrow(SyncJobExecutionError);

      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
      expect(errorSpy.mock.calls.flat().join(' ')).toContain(
        'inventory_propagation_suppressed_availability_unknown'
      );
    });

    it('should publish a known zero for a variant with no observed positions', async () => {
      const job = createJob({ productId: 'product-id', variantId: 'variant-id' });
      mockAvailability(0, 'computed', null);
      identifierMapping.getExternalIds.mockResolvedValue([
        {
          entityType: 'Offer',
          platformType: 'allegro',
          connectionId: 'connection-id',
          externalId: 'offer-id',
        },
      ]);
      jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'enqueued-job-id', isExisting: false });

      await handler.execute(job);

      expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({ payload: expect.objectContaining({ quantity: 0 }) })
      );
    });

    it('should keep the legacy product-level arm on the single-row read', async () => {
      const job = createJob({ productId: 'product-id' });
      const inventory = new InventoryItemEntity(
        'inventory-id',
        'product-id',
        null,
        42,
        0,
        null,
        new Date()
      );
      inventoryService.getInventory.mockResolvedValue(inventory);
      identifierMapping.getExternalIds.mockResolvedValue([
        {
          entityType: 'Offer',
          platformType: 'allegro',
          connectionId: 'connection-id',
          externalId: 'offer-id',
        },
      ]);
      jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'enqueued-job-id', isExisting: false });

      await handler.execute(job);

      expect(inventoryService.getInventory).toHaveBeenCalledWith('product-id', null, null);
      expect(availabilityService.getPromisableQuantities).not.toHaveBeenCalled();
      expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({ payload: expect.objectContaining({ quantity: 42 }) })
      );
    });

    it('should generate idempotency key correctly', async () => {
      const job = createJob({
        productId: 'product-id',
        inventoryUpdatedAt: '2026-01-01T12:00:00.000Z',
      });
      const inventory = new InventoryItemEntity(
        'inventory-id',
        'product-id',
        null,
        100,
        0,
        null,
        new Date()
      );

      inventoryService.getInventory.mockResolvedValue(inventory);
      identifierMapping.getExternalIds.mockResolvedValue([
        {
          entityType: 'Offer',
          platformType: 'allegro',
          connectionId: 'connection-id',
          externalId: 'offer-id',
        },
      ]);
      jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'enqueued-job-id', isExisting: false });

      await handler.execute(job);

      expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: 'inventory:connection-id:product-id:base:100:2026-01-01T12:00:00.000Z',
        })
      );
    });

    it('should carry the inventory write stamp as the write-order token (#2617)', async () => {
      const job = createJob({
        productId: 'product-id',
        inventoryUpdatedAt: '2026-01-01T12:00:00.000Z',
      });
      const inventory = new InventoryItemEntity(
        'inventory-id',
        'product-id',
        null,
        100,
        0,
        null,
        new Date()
      );

      inventoryService.getInventory.mockResolvedValue(inventory);
      identifierMapping.getExternalIds.mockResolvedValue([
        {
          entityType: 'Offer',
          platformType: 'allegro',
          connectionId: 'connection-id',
          externalId: 'offer-id',
        },
      ]);
      jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'enqueued-job-id', isExisting: false });

      await handler.execute(job);

      expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ observedAt: '2026-01-01T12:00:00.000Z' }),
        })
      );
    });

    it('should omit the write-order token when the propagation carries no stamp', async () => {
      const job = createJob({ productId: 'product-id' });
      const inventory = new InventoryItemEntity(
        'inventory-id',
        'product-id',
        null,
        100,
        0,
        null,
        new Date()
      );

      inventoryService.getInventory.mockResolvedValue(inventory);
      identifierMapping.getExternalIds.mockResolvedValue([
        {
          entityType: 'Offer',
          platformType: 'allegro',
          connectionId: 'connection-id',
          externalId: 'offer-id',
        },
      ]);
      jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'enqueued-job-id', isExisting: false });

      await handler.execute(job);

      const enqueued = jobEnqueue.enqueueJob.mock.calls[0][0];
      expect(enqueued.payload).not.toHaveProperty('observedAt');
    });

    it('should keep backward compatibility when inventoryUpdatedAt is missing', async () => {
      const job = createJob({ productId: 'product-id' });
      const inventory = new InventoryItemEntity(
        'inventory-id',
        'product-id',
        null,
        100,
        0,
        null,
        new Date()
      );

      inventoryService.getInventory.mockResolvedValue(inventory);
      identifierMapping.getExternalIds.mockResolvedValue([
        {
          entityType: 'Offer',
          platformType: 'allegro',
          connectionId: 'connection-id',
          externalId: 'offer-id',
        },
      ]);
      jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'enqueued-job-id', isExisting: false });

      await handler.execute(job);

      expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: 'inventory:connection-id:product-id:base:100:legacy',
        })
      );
    });

    it('should throw SyncJobExecutionError on failure', async () => {
      const job = createJob({ productId: 'product-id' });
      inventoryService.getInventory.mockRejectedValue(new Error('Database error'));

      await expect(handler.execute(job)).rejects.toThrow(SyncJobExecutionError);
    });

    it('should validate payload productId', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock: explicit any narrows the dynamic spy / fixture shape
      const job = createJob({ productId: '' as any });

      await expect(handler.execute(job)).rejects.toThrow(SyncJobExecutionError);
    });

    it('should handle multiple mappings across mixed platforms', async () => {
      const job = createJob({ productId: 'product-id' });
      const inventory = new InventoryItemEntity(
        'inventory-id',
        'product-id',
        null,
        100,
        0,
        null,
        new Date()
      );

      inventoryService.getInventory.mockResolvedValue(inventory);
      // Mix platforms across connections so the multi-mapping path explicitly
      // exercises the capability-agnostic loop, not just multiple Allegro
      // connections (#582).
      identifierMapping.getExternalIds.mockResolvedValue([
        {
          entityType: 'Offer',
          platformType: 'allegro',
          connectionId: 'connection-1',
          externalId: 'offer-1',
        },
        {
          entityType: 'Offer',
          platformType: 'shopify',
          connectionId: 'connection-2',
          externalId: 'offer-2',
        },
      ]);
      jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'enqueued-job-id', isExisting: false });

      await handler.execute(job);

      expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(2);
    });
  });

  describe('execute — ShopProduct write-back fan-out (#1498)', () => {
    const createJob = (payload: {
      productId: string;
      variantId?: string | null;
      inventoryUpdatedAt?: string | null;
    }): SyncJob => ({
      id: 'job-id',
      jobType: 'inventory.propagateToMarketplaces',
      connectionId: '',
      payload: payload as unknown as Record<string, unknown>,
      idempotencyKey: 'key',
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

    const variantInventory = new InventoryItemEntity(
      'inventory-id',
      'product-id',
      'variant-id',
      25,
      0,
      null,
      new Date()
    );

    const shopMapping = (connectionId: string, externalId: string): ExternalIdMapping => ({
      entityType: 'ShopProduct',
      platformType: 'woocommerce',
      connectionId,
      externalId,
    });

    beforeEach(() => {
      inventoryService.getInventory.mockResolvedValue(variantInventory);
      // #2324 — the variant-keyed path reads the seam; keep the same number the
      // legacy single-row fixture carried so the key assertions are unchanged.
      mockAvailability(25);
      jobEnqueue.enqueueJob.mockResolvedValue({ jobId: 'enqueued-job-id', isExisting: false });
    });

    it('should enqueue a quantity update for a ShopProduct mapping when the connection has OfferManager enabled', async () => {
      const job = createJob({
        productId: 'product-id',
        variantId: 'variant-id',
        inventoryUpdatedAt: '2026-01-01T12:00:00.000Z',
      });
      mockMappings({ ShopProduct: [shopMapping('wc-connection', '123')] });
      integrationsService.listCapabilityAdapters.mockResolvedValue([
        makeWriteBackTarget('wc-connection', ['OfferManager', 'ProductPublisher']),
      ] as never);

      await handler.execute(job);

      expect(identifierMapping.getExternalIds).toHaveBeenCalledWith('ShopProduct', 'variant-id');
      expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(1);
      expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({
          jobType: 'marketplace.offerQuantity.update',
          connectionId: 'wc-connection',
          payload: expect.objectContaining({ schemaVersion: 1, offerId: '123', quantity: 25 }),
          idempotencyKey:
            'inventory:wc-connection:product-id:variant-id:25:2026-01-01T12:00:00.000Z:shop:123',
        })
      );
    });

    it('should enqueue both branches with distinct idempotency keys when Offer and ShopProduct mappings share a connection', async () => {
      const job = createJob({
        productId: 'product-id',
        variantId: 'variant-id',
        inventoryUpdatedAt: '2026-01-01T12:00:00.000Z',
      });
      mockMappings({
        Offer: [
          {
            entityType: 'Offer',
            platformType: 'woocommerce',
            connectionId: 'wc-connection',
            externalId: '123',
          },
        ],
        ShopProduct: [shopMapping('wc-connection', '123')],
      });
      integrationsService.listCapabilityAdapters.mockResolvedValue([
        makeWriteBackTarget('wc-connection', ['OfferManager']),
      ] as never);

      await handler.execute(job);

      expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(2);
      const keys = jobEnqueue.enqueueJob.mock.calls.map(
        ([request]) => (request as { idempotencyKey: string }).idempotencyKey
      );
      expect(new Set(keys).size).toBe(2);
      expect(keys).toContain('inventory:wc-connection:product-id:variant-id:25:2026-01-01T12:00:00.000Z');
      expect(keys).toContain(
        'inventory:wc-connection:product-id:variant-id:25:2026-01-01T12:00:00.000Z:shop:123'
      );
    });

    it('should skip ShopProduct mappings when the connection does not have OfferManager enabled', async () => {
      const job = createJob({ productId: 'product-id', variantId: 'variant-id' });
      mockMappings({ ShopProduct: [shopMapping('publish-only-connection', '123')] });
      // publish-only connection: not returned by listCapabilityAdapters at all
      integrationsService.listCapabilityAdapters.mockResolvedValue([] as never);

      await handler.execute(job);

      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    });

    it('should never target the inventory-master connection even when OfferManager is enabled (authority guard)', async () => {
      const job = createJob({ productId: 'product-id', variantId: 'variant-id' });
      mockMappings({
        ShopProduct: [
          shopMapping('master-connection', '111'),
          shopMapping('destination-connection', '222'),
        ],
      });
      integrationsService.listCapabilityAdapters.mockResolvedValue([
        makeWriteBackTarget('master-connection', ['OfferManager', 'InventoryMaster']),
        makeWriteBackTarget('destination-connection', ['OfferManager']),
      ] as never);

      await handler.execute(job);

      expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(1);
      expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({ connectionId: 'destination-connection' })
      );
    });

    it('should skip the ShopProduct branch entirely for legacy product-level rows (variantId null)', async () => {
      const job = createJob({ productId: 'product-id' });
      mockMappings({ ShopProduct: [shopMapping('wc-connection', '123')] });

      await handler.execute(job);

      expect(identifierMapping.getExternalIds).toHaveBeenCalledWith('Offer', 'product-id');
      expect(identifierMapping.getExternalIds).not.toHaveBeenCalledWith(
        'ShopProduct',
        expect.anything()
      );
      expect(integrationsService.listCapabilityAdapters).not.toHaveBeenCalled();
      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    });

    it('should not query connections when there are no ShopProduct mappings', async () => {
      const job = createJob({ productId: 'product-id', variantId: 'variant-id' });
      mockMappings({});

      await handler.execute(job);

      expect(integrationsService.listCapabilityAdapters).not.toHaveBeenCalled();
      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    });
  });
});
