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
import { ICustomerIdentityResolverService } from '@openlinker/core/customers';
import { IOrderSyncService } from '../../interfaces/order-sync.service.interface';
import { IOrderRecordService } from '../../interfaces/order-record.service.interface';
import { OrderItemRefResolverService } from '../order-item-ref-resolver.service';
import { NoOrderDestinationsAvailableException } from '../../../domain/exceptions/no-order-destinations-available.exception';

describe('OrderIngestionService', () => {
  let service: OrderIngestionService;

  let integrationsService: jest.Mocked<IIntegrationsService>;
  let cursorRepository: jest.Mocked<ConnectionCursorRepositoryPort>;
  let jobQueue: jest.Mocked<SyncJobQueuePort>;
  let lock: jest.Mocked<SyncLockPort>;
  let identifierMapping: jest.Mocked<IIdentifierMappingService>;
  let orderSyncService: jest.Mocked<IOrderSyncService>;
  let orderRecordService: jest.Mocked<IOrderRecordService>;
  let marketplace: jest.Mocked<MarketplacePort>;
  let orderItemRefResolver: jest.Mocked<OrderItemRefResolverService>;
  let customerIdentityResolver: jest.Mocked<ICustomerIdentityResolverService>;

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

    customerIdentityResolver = {
      resolveCustomerIdentity: jest.fn().mockResolvedValue({
        internalCustomerId: 'ol_customer_test',
        usedEmailFallback: false,
        collisionDetected: false,
      }),
    } as unknown as jest.Mocked<ICustomerIdentityResolverService>;

    orderRecordService = {
      persistOrder: jest.fn().mockResolvedValue({}),
      updateSyncStatus: jest.fn().mockResolvedValue(undefined),
      getOrderRecord: jest.fn(),
    } as unknown as jest.Mocked<IOrderRecordService>;

    service = new OrderIngestionService(
      integrationsService,
      cursorRepository,
      jobQueue,
      lock,
      identifierMapping,
      orderItemRefResolver,
      orderSyncService,
      customerIdentityResolver,
      orderRecordService,
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

  describe('syncOrderFromMarketplace – customer resolution', () => {
    const externalOrderId = 'checkout-1';

    const baseIncoming = {
      externalOrderId,
      orderNumber: externalOrderId,
      status: 'BOUGHT',
      items: [],
      totals: { subtotal: 0, tax: 0, shipping: 0, total: 0, currency: 'PLN' },
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    beforeEach(() => {
      identifierMapping.getOrCreateInternalId.mockResolvedValue('ol_order_test');
      orderSyncService.syncOrder.mockResolvedValue([]);
    });

    it('should call resolveCustomerIdentity when customerExternalId and customerEmail are present', async () => {
      marketplace.getOrder.mockResolvedValueOnce({
        ...baseIncoming,
        customerExternalId: 'buyer-ext-1',
        customerEmail: 'buyer@example.com',
      });
      integrationsService.getCapabilityAdapter.mockResolvedValue(marketplace);

      await service.syncOrderFromMarketplace(connectionId, externalOrderId);

      expect(customerIdentityResolver.resolveCustomerIdentity).toHaveBeenCalledWith(
        expect.objectContaining({
          externalBuyerId: 'buyer-ext-1',
          email: 'buyer@example.com',
          sourceConnectionId: connectionId,
        }),
      );
      expect(identifierMapping.getOrCreateInternalId).not.toHaveBeenCalledWith(
        'Customer',
        expect.anything(),
        expect.anything(),
        expect.anything(),
      );
    });

    it('should fall back to identifierMapping when customerExternalId is present but email is absent', async () => {
      marketplace.getOrder.mockResolvedValueOnce({
        ...baseIncoming,
        customerExternalId: 'buyer-ext-2',
      });
      integrationsService.getCapabilityAdapter.mockResolvedValue(marketplace);

      await service.syncOrderFromMarketplace(connectionId, externalOrderId);

      expect(customerIdentityResolver.resolveCustomerIdentity).not.toHaveBeenCalled();
      expect(identifierMapping.getOrCreateInternalId).toHaveBeenCalledWith(
        'Customer',
        'buyer-ext-2',
        connectionId,
        expect.objectContaining({ parentEntityType: 'Order' }),
      );
    });
  });

  describe('syncOrderFromMarketplace – OrderRecord persistence', () => {
    const externalOrderId = 'checkout-persist-1';
    const internalOrderId = 'ol_order_persist_test';
    const sourceEventId = 'event-persist-1';

    const baseIncoming = {
      externalOrderId,
      orderNumber: externalOrderId,
      status: 'BOUGHT',
      items: [],
      totals: { subtotal: 0, tax: 0, shipping: 0, total: 0, currency: 'PLN' },
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    beforeEach(() => {
      identifierMapping.getOrCreateInternalId.mockResolvedValue(internalOrderId);
      marketplace.getOrder.mockResolvedValue(baseIncoming);
      integrationsService.getCapabilityAdapter.mockResolvedValue(marketplace);
    });

    it('should call persistOrder before syncOrder', async () => {
      const callOrder: string[] = [];
      orderRecordService.persistOrder.mockImplementation(() => {
        callOrder.push('persistOrder');
        return Promise.resolve({} as never);
      });
      orderSyncService.syncOrder.mockImplementation(() => {
        callOrder.push('syncOrder');
        return Promise.resolve([]);
      });

      await service.syncOrderFromMarketplace(connectionId, externalOrderId, sourceEventId);

      expect(callOrder).toEqual(['persistOrder', 'syncOrder']);
    });

    it('should call persistOrder with correct order id, connectionId, and sourceEventId', async () => {
      orderSyncService.syncOrder.mockResolvedValue([]);

      await service.syncOrderFromMarketplace(connectionId, externalOrderId, sourceEventId);

      expect(orderRecordService.persistOrder).toHaveBeenCalledTimes(1);
      expect(orderRecordService.persistOrder).toHaveBeenCalledWith(
        expect.objectContaining({ id: internalOrderId }),
        connectionId,
        sourceEventId,
      );
    });

    it('should call updateSyncStatus with status synced for a successful result', async () => {
      orderSyncService.syncOrder.mockResolvedValue([
        {
          destinationConnectionId: 'dest-conn-1',
          status: 'success',
          orderRef: { orderId: 'ps-order-42', orderNumber: 'ORD-42' },
        },
      ]);

      await service.syncOrderFromMarketplace(connectionId, externalOrderId, sourceEventId);

      expect(orderRecordService.updateSyncStatus).toHaveBeenCalledTimes(1);
      expect(orderRecordService.updateSyncStatus).toHaveBeenCalledWith(
        internalOrderId,
        'dest-conn-1',
        expect.objectContaining({
          destinationConnectionId: 'dest-conn-1',
          status: 'synced',
          externalOrderId: 'ps-order-42',
          externalOrderNumber: 'ORD-42',
        }),
      );
    });

    it('should call updateSyncStatus with status failed for a failed result', async () => {
      orderSyncService.syncOrder.mockResolvedValue([
        {
          destinationConnectionId: 'dest-conn-2',
          status: 'failed',
          error: { message: 'PrestaShop API timeout' },
        },
      ]);

      await service.syncOrderFromMarketplace(connectionId, externalOrderId, sourceEventId);

      expect(orderRecordService.updateSyncStatus).toHaveBeenCalledTimes(1);
      expect(orderRecordService.updateSyncStatus).toHaveBeenCalledWith(
        internalOrderId,
        'dest-conn-2',
        expect.objectContaining({
          destinationConnectionId: 'dest-conn-2',
          status: 'failed',
          error: 'PrestaShop API timeout',
        }),
      );
    });

    it('should call updateSyncStatus for all destinations on mixed results', async () => {
      orderSyncService.syncOrder.mockResolvedValue([
        {
          destinationConnectionId: 'dest-conn-ok',
          status: 'success',
          orderRef: { orderId: 'ps-ok-1' },
        },
        {
          destinationConnectionId: 'dest-conn-fail',
          status: 'failed',
          error: { message: 'Network error' },
        },
      ]);

      await service.syncOrderFromMarketplace(connectionId, externalOrderId, sourceEventId);

      expect(orderRecordService.updateSyncStatus).toHaveBeenCalledTimes(2);
      expect(orderRecordService.updateSyncStatus).toHaveBeenCalledWith(
        internalOrderId,
        'dest-conn-ok',
        expect.objectContaining({ status: 'synced' }),
      );
      expect(orderRecordService.updateSyncStatus).toHaveBeenCalledWith(
        internalOrderId,
        'dest-conn-fail',
        expect.objectContaining({ status: 'failed', error: 'Network error' }),
      );
    });

    it('should persist record but not call updateSyncStatus when syncOrder throws NoOrderDestinationsAvailableException', async () => {
      orderSyncService.syncOrder.mockRejectedValue(
        new NoOrderDestinationsAvailableException(internalOrderId, connectionId),
      );

      await expect(
        service.syncOrderFromMarketplace(connectionId, externalOrderId, sourceEventId),
      ).rejects.toThrow(NoOrderDestinationsAvailableException);

      expect(orderRecordService.persistOrder).toHaveBeenCalledTimes(1);
      expect(orderRecordService.updateSyncStatus).not.toHaveBeenCalled();
    });

    it('should not call persistOrder when getOrder throws', async () => {
      marketplace.getOrder.mockRejectedValueOnce(new Error('Marketplace fetch failed'));

      await expect(
        service.syncOrderFromMarketplace(connectionId, externalOrderId, sourceEventId),
      ).rejects.toThrow('Marketplace fetch failed');

      expect(orderRecordService.persistOrder).not.toHaveBeenCalled();
    });
  });
});

