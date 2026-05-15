/**
 * Order Ingestion Service Tests
 *
 * Unit tests for OrderIngestionService. Focus on cursor safety, locking, and enqueue behavior.
 *
 * @module libs/core/src/orders/application/services/__tests__
 */

import { OrderIngestionService } from '../order-ingestion.service';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { OrderSourcePort } from '@openlinker/core/orders';
import type {
  ISyncCursorsService,
  SyncJobQueuePort,
  SyncLockPort,
} from '@openlinker/core/sync';
import type { IIdentifierMappingService } from '@openlinker/core/identifier-mapping';
import type {
  ICustomerIdentityResolverService,
  IOrderCustomerProjectionUpdaterService,
} from '@openlinker/core/customers';
import type { IOrderSyncService } from '../../interfaces/order-sync.service.interface';
import type { IOrderRecordService } from '../../interfaces/order-record.service.interface';
import type { OrderItemRefResolverService } from '../order-item-ref-resolver.service';
import { MissingOrderItemMappingError } from '../../../domain/exceptions/missing-order-item-mapping.error';

describe('OrderIngestionService', () => {
  let service: OrderIngestionService;

  let integrationsService: jest.Mocked<IIntegrationsService>;
  // Only the two methods the SUT actually calls — tight Pick<> mock surface
  // per #718 review.
  let syncCursors: jest.Mocked<Pick<ISyncCursorsService, 'getCursor' | 'advanceCursor'>>;
  let jobQueue: jest.Mocked<SyncJobQueuePort>;
  let lock: jest.Mocked<SyncLockPort>;
  let identifierMapping: jest.Mocked<IIdentifierMappingService>;
  let orderSyncService: jest.Mocked<IOrderSyncService>;
  let orderRecordService: jest.Mocked<IOrderRecordService>;
  let orderSource: jest.Mocked<OrderSourcePort>;
  let orderItemRefResolver: jest.Mocked<OrderItemRefResolverService>;
  let customerIdentityResolver: jest.Mocked<ICustomerIdentityResolverService>;
  let customerProjectionUpdater: jest.Mocked<IOrderCustomerProjectionUpdaterService>;

  const connectionId = 'connection-123';
  const cursorKey = 'allegro.orders.lastEventId';

  beforeEach(() => {
    orderSource = {
      listOrderFeed: jest.fn(),
      getOrder: jest.fn(),
      updateOfferQuantity: jest.fn(),
    } as unknown as jest.Mocked<OrderSourcePort>;

    integrationsService = {
      getCapabilityAdapter: jest.fn().mockResolvedValue(orderSource),
      getAdapter: jest.fn(),
      listCapabilityAdapters: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;

    syncCursors = {
      getCursor: jest.fn(),
      advanceCursor: jest.fn(),
    };

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
      tryResolve: jest.fn(),
    } as unknown as jest.Mocked<OrderItemRefResolverService>;

    orderSyncService = {
      syncOrder: jest.fn(),
    } as unknown as jest.Mocked<IOrderSyncService>;

    orderRecordService = {
      persistOrder: jest.fn().mockResolvedValue({}),
      persistIncomingSnapshot: jest.fn().mockResolvedValue({}),
      updateSyncStatus: jest.fn().mockResolvedValue(undefined),
      getOrderRecord: jest.fn(),
    } as unknown as jest.Mocked<IOrderRecordService>;

    customerIdentityResolver = {
      resolveCustomerIdentity: jest.fn().mockResolvedValue({
        internalCustomerId: 'ol_customer_test',
        usedEmailFallback: false,
        collisionDetected: false,
      }),
    } as unknown as jest.Mocked<ICustomerIdentityResolverService>;

    customerProjectionUpdater = {
      updateProjectionsForOrder: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<IOrderCustomerProjectionUpdaterService>;

    service = new OrderIngestionService(
      integrationsService,
      syncCursors as unknown as ISyncCursorsService,
      jobQueue,
      lock,
      identifierMapping,
      orderItemRefResolver,
      orderSyncService,
      customerIdentityResolver,
      orderRecordService,
      customerProjectionUpdater
    );
  });

  describe('syncFromMarketplace', () => {
    it('skips when lock cannot be acquired', async () => {
      lock.acquire.mockResolvedValueOnce(null);

      const result = await service.ingestOrders(connectionId, { cursorKey, limit: 10 });

      expect(result.skippedDueToLock).toBe(true);
      expect(syncCursors.getCursor).not.toHaveBeenCalled();
      expect(jobQueue.enqueueBulk).not.toHaveBeenCalled();
      expect(syncCursors.advanceCursor).not.toHaveBeenCalled();
    });

    it('commits cursor only after enqueueBulk succeeds', async () => {
      lock.acquire.mockResolvedValueOnce('token-1');
      lock.release.mockResolvedValueOnce(true);

      syncCursors.getCursor.mockResolvedValueOnce('event-100');
      orderSource.listOrderFeed.mockResolvedValueOnce({
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

      const result = await service.ingestOrders(connectionId, { cursorKey, limit: 10 });

      expect(result.committed).toBe(true);
      expect(syncCursors.advanceCursor).toHaveBeenCalledWith(connectionId, cursorKey, 'event-101');
      expect(jobQueue.enqueueBulk).toHaveBeenCalledWith([
        expect.objectContaining({
          type: 'marketplace.order.sync',
          connectionId,
          payload: expect.objectContaining({
            externalOrderId: 'checkout-1',
            eventKey: 'event-101',
          }),
          options: { dedupeKey: `marketplace:${connectionId}:order:event-101` },
        }),
      ]);
    });

    it('does not commit cursor when enqueueBulk fails', async () => {
      lock.acquire.mockResolvedValueOnce('token-1');
      lock.release.mockResolvedValueOnce(true);

      syncCursors.getCursor.mockResolvedValueOnce('event-100');
      orderSource.listOrderFeed.mockResolvedValueOnce({
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

      await expect(service.ingestOrders(connectionId, { cursorKey, limit: 10 })).rejects.toThrow(
        'enqueue failed'
      );

      expect(syncCursors.advanceCursor).not.toHaveBeenCalled();
    });

    it('does not commit cursor when adapter returns a regressing cursor', async () => {
      lock.acquire.mockResolvedValueOnce('token-1');
      lock.release.mockResolvedValueOnce(true);

      syncCursors.getCursor.mockResolvedValueOnce('200');
      orderSource.listOrderFeed.mockResolvedValueOnce({
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

      const result = await service.ingestOrders(connectionId, { cursorKey, limit: 10 });

      expect(result.committed).toBe(false);
      expect(syncCursors.advanceCursor).not.toHaveBeenCalled();
    });
  });

  describe('syncOrderFromMarketplace – order record persistence', () => {
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
      orderSource.getOrder.mockResolvedValue(baseIncoming);
      integrationsService.getCapabilityAdapter.mockResolvedValue(orderSource);
    });

    it('should call persistIncomingSnapshot before item resolution, then persistOrder before syncOrder', async () => {
      orderSyncService.syncOrder.mockResolvedValue([]);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(orderRecordService.persistIncomingSnapshot).toHaveBeenCalledWith(
        baseIncoming,
        'ol_order_test',
        null,
        connectionId,
        null
      );
      expect(orderRecordService.persistOrder).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'ol_order_test' }),
        connectionId,
        null
      );
      expect(orderRecordService.persistIncomingSnapshot.mock.invocationCallOrder[0]).toBeLessThan(
        orderRecordService.persistOrder.mock.invocationCallOrder[0]
      );
      expect(orderRecordService.persistOrder.mock.invocationCallOrder[0]).toBeLessThan(
        orderSyncService.syncOrder.mock.invocationCallOrder[0]
      );
    });

    it('should call updateSyncStatus with synced when syncOrder succeeds', async () => {
      orderSyncService.syncOrder.mockResolvedValue([
        {
          status: 'success',
          destinationConnectionId: 'dest-conn-1',
          orderRef: { orderId: 'ext-order-1', orderNumber: 'ORD-001' },
        },
      ]);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(orderRecordService.updateSyncStatus).toHaveBeenCalledWith(
        'ol_order_test',
        'dest-conn-1',
        expect.objectContaining({ status: 'synced', externalOrderId: 'ext-order-1' })
      );
    });

    it('should call updateSyncStatus with failed when syncOrder returns a failure result', async () => {
      orderSyncService.syncOrder.mockResolvedValue([
        {
          status: 'failed',
          destinationConnectionId: 'dest-conn-1',
          error: { message: 'destination unavailable' },
        },
      ]);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(orderRecordService.updateSyncStatus).toHaveBeenCalledWith(
        'ol_order_test',
        'dest-conn-1',
        expect.objectContaining({ status: 'failed', error: 'destination unavailable' })
      );
    });

    it('should persist snapshot and order even when syncOrder throws', async () => {
      orderSyncService.syncOrder.mockRejectedValue(new Error('no destinations'));

      await expect(service.syncOrderFromSource(connectionId, externalOrderId)).rejects.toThrow(
        'no destinations'
      );

      expect(orderRecordService.persistIncomingSnapshot).toHaveBeenCalled();
      expect(orderRecordService.persistOrder).toHaveBeenCalled();
      expect(orderRecordService.updateSyncStatus).not.toHaveBeenCalled();
    });

    it('should log warning and continue when updateSyncStatus rejects for one destination', async () => {
      const warnSpy = jest.spyOn(service['logger'], 'warn');
      orderSyncService.syncOrder.mockResolvedValue([
        {
          status: 'success',
          destinationConnectionId: 'dest-conn-1',
          orderRef: { orderId: 'ext-order-1' },
        },
        {
          status: 'success',
          destinationConnectionId: 'dest-conn-2',
          orderRef: { orderId: 'ext-order-2' },
        },
      ]);
      orderRecordService.updateSyncStatus
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('db write failed'));

      await expect(
        service.syncOrderFromSource(connectionId, externalOrderId)
      ).resolves.not.toThrow();

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        'Failed to update order record sync status',
        expect.any(Error)
      );
    });

    it('should call customerProjectionUpdater after persistOrder and before syncOrder when internalCustomerId is resolved', async () => {
      orderSyncService.syncOrder.mockResolvedValue([]);
      orderSource.getOrder.mockResolvedValueOnce({
        ...baseIncoming,
        customerExternalId: 'buyer-ext-1',
        customerEmail: 'buyer@example.com',
      });
      identifierMapping.getOrCreateInternalId.mockResolvedValue('ol_order_test');

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(customerProjectionUpdater.updateProjectionsForOrder).toHaveBeenCalledTimes(1);
      expect(customerProjectionUpdater.updateProjectionsForOrder).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'ol_order_test' }),
        'ol_customer_test',
        connectionId
      );
      // Order: persistOrder → updateProjectionsForOrder → syncOrder
      expect(orderRecordService.persistOrder.mock.invocationCallOrder[0]).toBeLessThan(
        customerProjectionUpdater.updateProjectionsForOrder.mock.invocationCallOrder[0]
      );
      expect(
        customerProjectionUpdater.updateProjectionsForOrder.mock.invocationCallOrder[0]
      ).toBeLessThan(orderSyncService.syncOrder.mock.invocationCallOrder[0]);
    });

    it('should swallow errors from customerProjectionUpdater and still call syncOrder', async () => {
      const warnSpy = jest.spyOn(service['logger'], 'warn');
      orderSyncService.syncOrder.mockResolvedValue([]);
      orderSource.getOrder.mockResolvedValueOnce({
        ...baseIncoming,
        customerExternalId: 'buyer-ext-1',
        customerEmail: 'buyer@example.com',
      });
      customerProjectionUpdater.updateProjectionsForOrder.mockRejectedValueOnce(
        new Error('projection write failed')
      );

      await expect(
        service.syncOrderFromSource(connectionId, externalOrderId)
      ).resolves.not.toThrow();

      expect(orderSyncService.syncOrder).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to update customer projections'),
        expect.any(Error)
      );
    });

    it('should skip customerProjectionUpdater when internalCustomerId is not resolved', async () => {
      orderSyncService.syncOrder.mockResolvedValue([]);
      orderSource.getOrder.mockResolvedValueOnce(baseIncoming); // no buyer info → no resolution call

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(customerProjectionUpdater.updateProjectionsForOrder).not.toHaveBeenCalled();
      expect(orderSyncService.syncOrder).toHaveBeenCalled();
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
      orderSource.getOrder.mockResolvedValueOnce({
        ...baseIncoming,
        customerExternalId: 'buyer-ext-1',
        customerEmail: 'buyer@example.com',
      });
      integrationsService.getCapabilityAdapter.mockResolvedValue(orderSource);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(customerIdentityResolver.resolveCustomerIdentity).toHaveBeenCalledWith(
        expect.objectContaining({
          externalBuyerId: 'buyer-ext-1',
          email: 'buyer@example.com',
          sourceConnectionId: connectionId,
        })
      );
      expect(identifierMapping.getOrCreateInternalId).not.toHaveBeenCalledWith(
        'Customer',
        expect.anything(),
        expect.anything(),
        expect.anything()
      );
    });

    it('should fall back to identifierMapping when customerExternalId is present but email is absent', async () => {
      orderSource.getOrder.mockResolvedValueOnce({
        ...baseIncoming,
        customerExternalId: 'buyer-ext-2',
      });
      integrationsService.getCapabilityAdapter.mockResolvedValue(orderSource);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(customerIdentityResolver.resolveCustomerIdentity).not.toHaveBeenCalled();
      expect(identifierMapping.getOrCreateInternalId).toHaveBeenCalledWith(
        'Customer',
        'buyer-ext-2',
        connectionId,
        expect.objectContaining({ parentEntityType: 'Order' })
      );
    });
  });

  describe('syncOrderFromMarketplace – item resolution', () => {
    const externalOrderId = 'checkout-item-test';

    const incomingWithItems = {
      externalOrderId,
      orderNumber: externalOrderId,
      status: 'BOUGHT',
      items: [
        {
          id: 'item-1',
          productRef: { type: 'offer' as const, externalId: 'offer-a' },
          quantity: 1,
          price: 9.99,
          name: 'Offer A',
          imageUrl: 'https://cdn.example/a.jpg',
        },
        {
          id: 'item-2',
          productRef: { type: 'offer' as const, externalId: 'offer-b' },
          quantity: 2,
          price: 4.99,
        },
      ],
      totals: { subtotal: 19.97, tax: 0, shipping: 0, total: 19.97, currency: 'PLN' },
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
    };

    beforeEach(() => {
      identifierMapping.getOrCreateInternalId.mockResolvedValue('ol_order_item_test');
      orderSource.getOrder.mockResolvedValue(incomingWithItems);
      integrationsService.getCapabilityAdapter.mockResolvedValue(orderSource);
      orderSyncService.syncOrder.mockResolvedValue([]);
    });

    it('happy path: all items resolve — persistIncomingSnapshot then persistOrder called', async () => {
      orderItemRefResolver.tryResolve
        .mockResolvedValueOnce({
          resolved: true,
          internalProductId: 'p-1',
          internalVariantId: 'v-1',
        })
        .mockResolvedValueOnce({
          resolved: true,
          internalProductId: 'p-2',
          internalVariantId: 'v-2',
        });

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(orderRecordService.persistIncomingSnapshot).toHaveBeenCalledTimes(1);
      expect(orderRecordService.persistOrder).toHaveBeenCalledTimes(1);
      expect(orderSyncService.syncOrder).toHaveBeenCalledTimes(1);

      // buildUnifiedOrder must propagate IncomingOrderItem.name / imageUrl
      // onto the resolved OrderItem so persistOrder can persist them. This
      // is the only test that exercises the IncomingOrderItem → OrderItem
      // conversion; the persistOrder spec works with Order directly.
      const persistedOrder = orderRecordService.persistOrder.mock.calls[0][0];
      expect(persistedOrder.items).toHaveLength(2);
      expect(persistedOrder.items[0]).toMatchObject({
        id: 'item-1',
        name: 'Offer A',
        imageUrl: 'https://cdn.example/a.jpg',
      });
      expect(persistedOrder.items[1].name).toBeUndefined();
      expect(persistedOrder.items[1].imageUrl).toBeUndefined();
    });

    it('partial unresolved: persistIncomingSnapshot called, MissingOrderItemMappingError thrown, persistOrder NOT called', async () => {
      orderItemRefResolver.tryResolve
        .mockResolvedValueOnce({
          resolved: true,
          internalProductId: 'p-1',
          internalVariantId: 'v-1',
        })
        .mockResolvedValueOnce({
          resolved: false,
          productRef: { type: 'offer', externalId: 'offer-b' },
          reason: 'no mapping',
        });

      await expect(
        service.syncOrderFromSource(connectionId, externalOrderId)
      ).rejects.toBeInstanceOf(MissingOrderItemMappingError);

      expect(orderRecordService.persistIncomingSnapshot).toHaveBeenCalledTimes(1);
      expect(orderRecordService.persistOrder).not.toHaveBeenCalled();
      expect(orderSyncService.syncOrder).not.toHaveBeenCalled();
    });

    it('all unresolved: persistIncomingSnapshot called, MissingOrderItemMappingError thrown, persistOrder NOT called', async () => {
      orderItemRefResolver.tryResolve
        .mockResolvedValueOnce({
          resolved: false,
          productRef: { type: 'offer', externalId: 'offer-a' },
          reason: 'no mapping a',
        })
        .mockResolvedValueOnce({
          resolved: false,
          productRef: { type: 'offer', externalId: 'offer-b' },
          reason: 'no mapping b',
        });

      await expect(
        service.syncOrderFromSource(connectionId, externalOrderId)
      ).rejects.toBeInstanceOf(MissingOrderItemMappingError);

      expect(orderRecordService.persistIncomingSnapshot).toHaveBeenCalledTimes(1);
      expect(orderRecordService.persistOrder).not.toHaveBeenCalled();
    });
  });
});
