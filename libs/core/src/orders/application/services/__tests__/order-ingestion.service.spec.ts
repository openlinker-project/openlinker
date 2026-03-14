/**
 * Order Ingestion Service Tests
 *
 * Unit tests for OrderIngestionService. Focus on cursor safety, locking, and enqueue behavior.
 *
 * @module libs/core/src/orders/application/services/__tests__
 */

import { OrderIngestionService } from '../order-ingestion.service';
import { IIntegrationsService, MarketplacePort } from '@openlinker/core/integrations';
import {
  ConnectionCursorRepositoryPort,
  SyncJobQueuePort,
  SyncLockPort,
} from '@openlinker/core/sync';
import { IIdentifierMappingService } from '@openlinker/core/identifier-mapping';
import { IOrderSyncService } from '../../interfaces/order-sync.service.interface';
import { OrderItemRefResolverService } from '../order-item-ref-resolver.service';

describe('OrderIngestionService', () => {
  let service: OrderIngestionService;

  let integrationsService: jest.Mocked<IIntegrationsService>;
  let cursorRepository: jest.Mocked<ConnectionCursorRepositoryPort>;
  let jobQueue: jest.Mocked<SyncJobQueuePort>;
  let lock: jest.Mocked<SyncLockPort>;
  let identifierMapping: jest.Mocked<IIdentifierMappingService>;
  let orderSyncService: jest.Mocked<IOrderSyncService>;
  let marketplace: jest.Mocked<MarketplacePort>;
  let orderItemRefResolver: jest.Mocked<OrderItemRefResolverService>;

  const connectionId = 'connection-123';
  const cursorKey = 'allegro.orders.lastEventId';

  beforeEach(() => {
    marketplace = {
      listOrderFeed: jest.fn(),
      getOrder: jest.fn(),
      updateOfferQuantity: jest.fn(),
    } as unknown as jest.Mocked<MarketplacePort>;

    integrationsService = {
      getCapabilityAdapter: jest.fn().mockResolvedValue(marketplace),
      getAdapter: jest.fn(),
      listCapabilityAdapters: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;

    cursorRepository = {
      get: jest.fn(),
      set: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<ConnectionCursorRepositoryPort>;

    jobQueue = {
      enqueue: jest.fn(),
      enqueueBulk: jest.fn(),
    } as unknown as jest.Mocked<SyncJobQueuePort>;

    lock = {
      acquire: jest.fn(),
      release: jest.fn(),
    } as unknown as jest.Mocked<SyncLockPort>;

    identifierMapping = {
      getOrCreateInternalId: jest.fn(),
      getInternalId: jest.fn(),
      getExternalIds: jest.fn(),
      createMapping: jest.fn(),
      batchGetOrCreateInternalIds: jest.fn(),
      deleteMapping: jest.fn(),
    } as unknown as jest.Mocked<IIdentifierMappingService>;

    orderItemRefResolver = {
      resolve: jest.fn(),
    } as unknown as jest.Mocked<OrderItemRefResolverService>;

    orderSyncService = {
      syncOrder: jest.fn(),
    } as unknown as jest.Mocked<IOrderSyncService>;

    service = new OrderIngestionService(
      integrationsService,
      cursorRepository,
      jobQueue,
      lock,
      identifierMapping,
      orderItemRefResolver,
      orderSyncService,
    );
  });

  describe('syncFromMarketplace', () => {
    it('skips when lock cannot be acquired', async () => {
      lock.acquire.mockResolvedValueOnce(null);

      const result = await service.syncFromMarketplace(connectionId, { cursorKey, limit: 10 });

      expect(result.skippedDueToLock).toBe(true);
      expect(cursorRepository.get).not.toHaveBeenCalled();
      expect(jobQueue.enqueueBulk).not.toHaveBeenCalled();
      expect(cursorRepository.set).not.toHaveBeenCalled();
    });

    it('commits cursor only after enqueueBulk succeeds', async () => {
      lock.acquire.mockResolvedValueOnce('token-1');
      lock.release.mockResolvedValueOnce(true);

      cursorRepository.get.mockResolvedValueOnce('event-100');
      marketplace.listOrderFeed.mockResolvedValueOnce({
        items: [
          {
            externalOrderId: 'checkout-1',
            eventType: 'updated',
            occurredAt: '2024-01-01T00:00:00Z',
            eventKey: 'event-101',
          },
        ],
        nextCursor: 'event-101',
      });

      jobQueue.enqueueBulk.mockResolvedValueOnce([]);

      const result = await service.syncFromMarketplace(connectionId, { cursorKey, limit: 10 });

      expect(result.committed).toBe(true);
      expect(cursorRepository.set).toHaveBeenCalledWith(connectionId, cursorKey, 'event-101');
      expect(jobQueue.enqueueBulk).toHaveBeenCalledWith([
        expect.objectContaining({
          type: 'marketplace.order.sync',
          connectionId,
          payload: expect.objectContaining({ externalOrderId: 'checkout-1', eventKey: 'event-101' }),
          options: { dedupeKey: `marketplace:${connectionId}:order:event-101` },
        }),
      ]);
    });

    it('does not commit cursor when enqueueBulk fails', async () => {
      lock.acquire.mockResolvedValueOnce('token-1');
      lock.release.mockResolvedValueOnce(true);

      cursorRepository.get.mockResolvedValueOnce('event-100');
      marketplace.listOrderFeed.mockResolvedValueOnce({
        items: [
          {
            externalOrderId: 'checkout-1',
            eventType: 'updated',
            occurredAt: '2024-01-01T00:00:00Z',
            eventKey: 'event-101',
          },
        ],
        nextCursor: 'event-101',
      });

      jobQueue.enqueueBulk.mockRejectedValueOnce(new Error('enqueue failed'));

      await expect(
        service.syncFromMarketplace(connectionId, { cursorKey, limit: 10 }),
      ).rejects.toThrow('enqueue failed');

      expect(cursorRepository.set).not.toHaveBeenCalled();
    });

    it('does not commit cursor when adapter returns a regressing cursor', async () => {
      lock.acquire.mockResolvedValueOnce('token-1');
      lock.release.mockResolvedValueOnce(true);

      cursorRepository.get.mockResolvedValueOnce('200');
      marketplace.listOrderFeed.mockResolvedValueOnce({
        items: [
          {
            externalOrderId: 'checkout-1',
            eventType: 'updated',
            occurredAt: '2024-01-01T00:00:00Z',
            eventKey: '201',
          },
        ],
        nextCursor: '100',
      });

      jobQueue.enqueueBulk.mockResolvedValueOnce([]);

      const result = await service.syncFromMarketplace(connectionId, { cursorKey, limit: 10 });

      expect(result.committed).toBe(false);
      expect(cursorRepository.set).not.toHaveBeenCalled();
    });
  });
});

