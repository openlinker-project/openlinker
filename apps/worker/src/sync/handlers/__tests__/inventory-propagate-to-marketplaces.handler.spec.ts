/**
 * Inventory Propagate to Marketplaces Handler Tests
 *
 * Unit tests for InventoryPropagateToMarketplacesHandler. Tests inventory
 * propagation, offer mapping lookup, and job enqueueing.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import { InventoryPropagateToMarketplacesHandler } from '../inventory-propagate-to-marketplaces.handler';
import { IIdentifierMappingService } from '@openlinker/core/identifier-mapping';
import { IInventoryService } from '@openlinker/core/inventory';
import { JobEnqueuePort } from '@openlinker/core/sync';
import { SyncJobEntity as SyncJob } from '@openlinker/core/sync';
import { InventoryItemEntity } from '@openlinker/core/inventory';
import { SyncJobExecutionError } from '@openlinker/core/sync';

describe('InventoryPropagateToMarketplacesHandler', () => {
  let handler: InventoryPropagateToMarketplacesHandler;
  let identifierMapping: jest.Mocked<IIdentifierMappingService>;
  let inventoryService: jest.Mocked<IInventoryService>;
  let jobEnqueue: jest.Mocked<JobEnqueuePort>;

  beforeEach(() => {
    identifierMapping = {
      getOrCreateInternalId: jest.fn(),
      getInternalId: jest.fn(),
      getExternalIds: jest.fn(),
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

    handler = new InventoryPropagateToMarketplacesHandler(
      identifierMapping,
      inventoryService,
      jobEnqueue,
    );
  });

  describe('execute', () => {
    const createJob = (payload: { productId: string; variantId?: string | null; inventoryUpdatedAt?: string | null }): SyncJob => ({
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
        new Date(),
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
        }),
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
        new Date(),
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
        new Date(),
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
        }),
      );
      expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: 'amazon-connection',
          payload: expect.objectContaining({ offerId: 'amazon-offer' }),
        }),
      );
    });

    it('should handle variant-specific inventory', async () => {
      const job = createJob({ productId: 'product-id', variantId: 'variant-id' });
      const inventory = new InventoryItemEntity(
        'inventory-id',
        'product-id',
        'variant-id',
        50,
        0,
        null,
        new Date(),
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

      expect(inventoryService.getInventory).toHaveBeenCalledWith('product-id', 'variant-id', null);
      expect(identifierMapping.getExternalIds).toHaveBeenCalledWith('Offer', 'variant-id');
      expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            quantity: 50,
          }),
        }),
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
        new Date(),
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
          idempotencyKey:
            'inventory:connection-id:product-id:base:100:2026-01-01T12:00:00.000Z',
        }),
      );
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
        new Date(),
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
        }),
      );
    });

    it('should throw SyncJobExecutionError on failure', async () => {
      const job = createJob({ productId: 'product-id' });
      inventoryService.getInventory.mockRejectedValue(new Error('Database error'));

      await expect(handler.execute(job)).rejects.toThrow(SyncJobExecutionError);
    });

    it('should validate payload productId', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        new Date(),
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
});



