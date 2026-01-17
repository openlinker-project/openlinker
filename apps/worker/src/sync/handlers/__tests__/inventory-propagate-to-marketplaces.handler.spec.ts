/**
 * Inventory Propagate to Marketplaces Handler Tests
 *
 * Unit tests for InventoryPropagateToMarketplacesHandler. Tests inventory
 * propagation, offer mapping lookup, and job enqueueing.
 *
 * @module apps/worker/src/sync/handlers/__tests__
 */
import { InventoryPropagateToMarketplacesHandler } from '../inventory-propagate-to-marketplaces.handler';
import { IOfferMappingService } from '@openlinker/core/listings';
import { IInventoryService } from '@openlinker/core/inventory';
import { JobEnqueuePort } from '@openlinker/core/sync';
import { SyncJob } from '@openlinker/core/sync/domain/entities/sync-job.entity';
import { OfferMapping } from '@openlinker/core/listings/domain/entities/offer-mapping.entity';
import { InventoryItemEntity } from '@openlinker/core/inventory';
import { SyncJobExecutionError } from '@openlinker/core/sync/domain/exceptions/sync-job-execution.error';

describe('InventoryPropagateToMarketplacesHandler', () => {
  let handler: InventoryPropagateToMarketplacesHandler;
  let offerMappingService: jest.Mocked<IOfferMappingService>;
  let inventoryService: jest.Mocked<IInventoryService>;
  let jobEnqueue: jest.Mocked<JobEnqueuePort>;

  beforeEach(() => {
    offerMappingService = {
      findById: jest.fn(),
      findByConnectionAndOffer: jest.fn(),
      findByProduct: jest.fn(),
      findByConnection: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<IOfferMappingService>;

    inventoryService = {
      setInventory: jest.fn(),
      getInventory: jest.fn(),
    } as unknown as jest.Mocked<IInventoryService>;

    jobEnqueue = {
      enqueueJob: jest.fn(),
    } as unknown as jest.Mocked<JobEnqueuePort>;

    handler = new InventoryPropagateToMarketplacesHandler(
      offerMappingService,
      inventoryService,
      jobEnqueue,
    );
  });

  describe('execute', () => {
    const createJob = (payload: { productId: string; variantId?: string | null }): SyncJob => ({
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
      const mapping = new OfferMapping(
        'mapping-id',
        'connection-id',
        'allegro',
        'offer-id',
        'product-id',
        null,
        new Date(),
        new Date(),
      );

      inventoryService.getInventory.mockResolvedValue(inventory);
      offerMappingService.findByProduct.mockResolvedValue([mapping]);
      jobEnqueue.enqueueJob.mockResolvedValue('enqueued-job-id');

      await handler.execute(job);

      expect(inventoryService.getInventory).toHaveBeenCalledWith('product-id', null, null);
      expect(offerMappingService.findByProduct).toHaveBeenCalledWith('product-id');
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

      expect(offerMappingService.findByProduct).not.toHaveBeenCalled();
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
      offerMappingService.findByProduct.mockResolvedValue([]);

      await handler.execute(job);

      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    });

    it('should filter to only Allegro mappings', async () => {
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
      const allegroMapping = new OfferMapping(
        'allegro-mapping-id',
        'connection-id',
        'allegro',
        'offer-id',
        'product-id',
        null,
        new Date(),
        new Date(),
      );
      const otherMapping = new OfferMapping(
        'other-mapping-id',
        'connection-id',
        'amazon',
        'offer-id',
        'product-id',
        null,
        new Date(),
        new Date(),
      );

      inventoryService.getInventory.mockResolvedValue(inventory);
      offerMappingService.findByProduct.mockResolvedValue([allegroMapping, otherMapping]);
      jobEnqueue.enqueueJob.mockResolvedValue('enqueued-job-id');

      await handler.execute(job);

      expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(1);
      expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: 'connection-id',
          payload: expect.objectContaining({
            offerId: 'offer-id',
          }),
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
      const mapping = new OfferMapping(
        'mapping-id',
        'connection-id',
        'allegro',
        'offer-id',
        'product-id',
        'variant-id',
        new Date(),
        new Date(),
      );

      inventoryService.getInventory.mockResolvedValue(inventory);
      offerMappingService.findByProduct.mockResolvedValue([mapping]);
      jobEnqueue.enqueueJob.mockResolvedValue('enqueued-job-id');

      await handler.execute(job);

      expect(inventoryService.getInventory).toHaveBeenCalledWith('product-id', 'variant-id', null);
      expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            quantity: 50,
          }),
        }),
      );
    });

    it('should generate idempotency key correctly', async () => {
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
      const mapping = new OfferMapping(
        'mapping-id',
        'connection-id',
        'allegro',
        'offer-id',
        'product-id',
        null,
        new Date(),
        new Date(),
      );

      inventoryService.getInventory.mockResolvedValue(inventory);
      offerMappingService.findByProduct.mockResolvedValue([mapping]);
      jobEnqueue.enqueueJob.mockResolvedValue('enqueued-job-id');

      await handler.execute(job);

      expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({
          idempotencyKey: 'inventory:connection-id:product-id:base:100',
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

    it('should handle multiple mappings', async () => {
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
      const mapping1 = new OfferMapping(
        'mapping-1',
        'connection-1',
        'allegro',
        'offer-1',
        'product-id',
        null,
        new Date(),
        new Date(),
      );
      const mapping2 = new OfferMapping(
        'mapping-2',
        'connection-2',
        'allegro',
        'offer-2',
        'product-id',
        null,
        new Date(),
        new Date(),
      );

      inventoryService.getInventory.mockResolvedValue(inventory);
      offerMappingService.findByProduct.mockResolvedValue([mapping1, mapping2]);
      jobEnqueue.enqueueJob.mockResolvedValue('enqueued-job-id');

      await handler.execute(job);

      expect(jobEnqueue.enqueueJob).toHaveBeenCalledTimes(2);
    });
  });
});



