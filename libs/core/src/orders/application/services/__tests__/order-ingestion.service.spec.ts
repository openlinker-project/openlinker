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
import type { IOrderItemRefResolverService } from '../../interfaces/order-item-ref-resolver.service.interface';
import type { IOrderLifecycleRelayService } from '../../interfaces/order-lifecycle-relay.service.interface';
import type { IAutoIssueTriggerService } from '@openlinker/core/invoicing';
import { MissingOrderItemMappingError } from '../../../domain/exceptions/missing-order-item-mapping.error';
import type { OrderRecord } from '../../../domain/entities/order-record.entity';

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
  let orderItemRefResolver: jest.Mocked<IOrderItemRefResolverService>;
  let customerIdentityResolver: jest.Mocked<ICustomerIdentityResolverService>;
  let customerProjectionUpdater: jest.Mocked<IOrderCustomerProjectionUpdaterService>;
  let orderLifecycleRelay: jest.Mocked<IOrderLifecycleRelayService>;
  let autoIssueTrigger: jest.Mocked<IAutoIssueTriggerService>;

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
    } as unknown as jest.Mocked<IOrderItemRefResolverService>;

    orderSyncService = {
      syncOrder: jest.fn(),
    } as unknown as jest.Mocked<IOrderSyncService>;

    orderRecordService = {
      persistOrder: jest.fn().mockResolvedValue({}),
      persistIncomingSnapshot: jest.fn().mockResolvedValue({}),
      updateSyncStatus: jest.fn().mockResolvedValue(undefined),
      getOrderRecord: jest.fn(),
      findMany: jest.fn(),
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

    orderLifecycleRelay = {
      relay: jest.fn().mockResolvedValue({ targets: [] }),
    } as unknown as jest.Mocked<IOrderLifecycleRelayService>;
    autoIssueTrigger = {
      onOrderTransition: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<IAutoIssueTriggerService>;

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
      customerProjectionUpdater,
      orderLifecycleRelay,
      autoIssueTrigger
    );
  });

  describe('auto-issue trigger (OL #1120)', () => {
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

    it('calls onOrderTransition at the terminal path with the in-scope sourceEventId as the 3rd arg', async () => {
      orderSyncService.syncOrder.mockResolvedValue([]);

      await service.syncOrderFromSource(connectionId, externalOrderId, 'evt-42');

      expect(autoIssueTrigger.onOrderTransition).toHaveBeenCalledTimes(1);
      const [order, srcConn, evt] = autoIssueTrigger.onOrderTransition.mock.calls[0];
      expect(order).toEqual(expect.objectContaining({ id: 'ol_order_test' }));
      expect(srcConn).toBe(connectionId);
      expect(evt).toBe('evt-42');
      // Fires only after destination status is settled.
      expect(orderSyncService.syncOrder.mock.invocationCallOrder[0]).toBeLessThan(
        autoIssueTrigger.onOrderTransition.mock.invocationCallOrder[0]
      );
    });

    it('swallows a thrown onOrderTransition failure — order sync still returns results — with a PII-safe log', async () => {
      const warnSpy = jest
        .spyOn((service as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn')
        .mockImplementation(() => undefined);
      orderSyncService.syncOrder.mockResolvedValue([]);
      autoIssueTrigger.onOrderTransition.mockRejectedValueOnce(
        new Error('issuance exploded for buyer Jan Kowalski')
      );

      const results = await service.syncOrderFromSource(connectionId, externalOrderId, 'evt-7');

      expect(results).toEqual([]);
      const logged = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(logged).not.toContain('Jan Kowalski');
      expect(logged).not.toContain('correlationId');
      expect(logged).toContain('evt-7');
      warnSpy.mockRestore();
    });

    it('a destination-echo re-read returns [] and does NOT call onOrderTransition', async () => {
      orderRecordService.getOrderRecord.mockResolvedValueOnce({
        sourceConnectionId: 'other-connection',
      } as never);

      const results = await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(results).toEqual([]);
      expect(autoIssueTrigger.onOrderTransition).not.toHaveBeenCalled();
    });
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

    it('should carry incoming.placedAt onto the unified Order as a Date (#926)', async () => {
      orderSource.getOrder.mockResolvedValueOnce({
        ...baseIncoming,
        placedAt: '2026-05-31T16:00:00.000Z',
      });
      orderSyncService.syncOrder.mockResolvedValue([]);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      const order = orderRecordService.persistOrder.mock.calls[0][0];
      expect(order.placedAt).toEqual(new Date('2026-05-31T16:00:00.000Z'));
    });

    it('should leave Order.placedAt undefined when the incoming order omits it (#926)', async () => {
      // baseIncoming carries no placedAt.
      orderSyncService.syncOrder.mockResolvedValue([]);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      const order = orderRecordService.persistOrder.mock.calls[0][0];
      expect(order.placedAt).toBeUndefined();
    });

    it('should carry incoming.customerEmail onto the unified Order (#948)', async () => {
      orderSource.getOrder.mockResolvedValueOnce({
        ...baseIncoming,
        customerEmail: 'buyer@example.com',
      });
      orderSyncService.syncOrder.mockResolvedValue([]);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      const order = orderRecordService.persistOrder.mock.calls[0][0];
      expect(order.customerEmail).toBe('buyer@example.com');
    });

    it('should leave Order.customerEmail undefined when the incoming order omits it (#948)', async () => {
      // baseIncoming carries no customerEmail.
      orderSyncService.syncOrder.mockResolvedValue([]);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      const order = orderRecordService.persistOrder.mock.calls[0][0];
      expect(order.customerEmail).toBeUndefined();
    });

    it('should carry incoming.shipping and pickupPoint onto the unified Order (#952)', async () => {
      orderSource.getOrder.mockResolvedValueOnce({
        ...baseIncoming,
        shipping: { methodId: 'allegro-courier-1', methodName: 'Kurier DPD' },
        pickupPoint: { id: 'POZ08A', name: 'Paczkomat POZ08A' },
      });
      orderSyncService.syncOrder.mockResolvedValue([]);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      const order = orderRecordService.persistOrder.mock.calls[0][0];
      expect(order.shipping).toEqual({ methodId: 'allegro-courier-1', methodName: 'Kurier DPD' });
      expect(order.pickupPoint).toEqual({ id: 'POZ08A', name: 'Paczkomat POZ08A' });
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

  describe('syncOrderFromSource – destination-echo guard (#940)', () => {
    const externalOrderId = 'ps-order-7';

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
      identifierMapping.getOrCreateInternalId.mockResolvedValue('ol_order_echo');
      orderSource.getOrder.mockResolvedValue(baseIncoming);
      integrationsService.getCapabilityAdapter.mockResolvedValue(orderSource);
    });

    it('should skip re-ingestion and return [] when the resolved order originated from a different connection', async () => {
      orderRecordService.getOrderRecord.mockResolvedValue({
        sourceConnectionId: 'allegro-connection',
      } as unknown as OrderRecord);

      const result = await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(result).toEqual([]);
      // Source attribution, snapshot and sync history must be left untouched.
      expect(orderRecordService.persistIncomingSnapshot).not.toHaveBeenCalled();
      expect(orderRecordService.persistOrder).not.toHaveBeenCalled();
      expect(orderSyncService.syncOrder).not.toHaveBeenCalled();
      expect(orderItemRefResolver.tryResolve).not.toHaveBeenCalled();
    });

    it('should proceed with ingestion when no existing order record is found (genuinely new order)', async () => {
      orderRecordService.getOrderRecord.mockResolvedValue(null);
      orderSyncService.syncOrder.mockResolvedValue([]);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(orderRecordService.persistIncomingSnapshot).toHaveBeenCalled();
      expect(orderRecordService.persistOrder).toHaveBeenCalled();
      expect(orderSyncService.syncOrder).toHaveBeenCalled();
    });

    it('should proceed with ingestion when the existing order shares the same source connection (genuine same-source reconcile)', async () => {
      orderRecordService.getOrderRecord.mockResolvedValue({
        sourceConnectionId: connectionId,
      } as unknown as OrderRecord);
      orderSyncService.syncOrder.mockResolvedValue([]);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(orderRecordService.persistIncomingSnapshot).toHaveBeenCalled();
      expect(orderRecordService.persistOrder).toHaveBeenCalled();
      expect(orderSyncService.syncOrder).toHaveBeenCalled();
    });
  });

  describe('syncOrderFromSource – cancellation-observe hook (#1146)', () => {
    const externalOrderId = 'checkout-cancel';
    const internalOrderId = 'ol_order_cancel';
    const dedupeKey = `marketplace:${connectionId}:stockRestore:${internalOrderId}`;

    const cancelledIncoming = {
      externalOrderId,
      orderNumber: externalOrderId,
      status: 'cancelled',
      items: [],
      totals: { subtotal: 0, tax: 0, shipping: 0, total: 0, currency: 'PLN' },
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
    };

    beforeEach(() => {
      identifierMapping.getOrCreateInternalId.mockResolvedValue(internalOrderId);
      integrationsService.getCapabilityAdapter.mockResolvedValue(orderSource);
      orderSyncService.syncOrder.mockResolvedValue([]);
    });

    it('should enqueue a stockRestore job when an order transitions to cancelled', async () => {
      orderSource.getOrder.mockResolvedValue(cancelledIncoming);
      // Prior record has a non-cancelled status → transition fires.
      orderRecordService.getOrderRecord.mockResolvedValue({
        sourceConnectionId: connectionId,
        orderSnapshot: { status: 'BOUGHT' },
      } as unknown as OrderRecord);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      // Both the early-fire hook (before item resolution) and the post-persistOrder
      // hook fire — both carry the same dedupeKey, so the job queue deduplicates
      // them to a single job in production.
      expect(jobQueue.enqueue).toHaveBeenCalledTimes(2);
      expect(jobQueue.enqueue).toHaveBeenCalledWith({
        type: 'marketplace.offer.stockRestore',
        connectionId,
        payload: { schemaVersion: 1, internalOrderId },
        options: { dedupeKey },
      });
    });

    it('should enqueue when a first-seen order is already cancelled (no prior record)', async () => {
      orderSource.getOrder.mockResolvedValue(cancelledIncoming);
      orderRecordService.getOrderRecord.mockResolvedValue(null);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      // Early-fire + post-persistOrder, same dedupeKey → one actual job in production.
      expect(jobQueue.enqueue).toHaveBeenCalledTimes(2);
      expect(jobQueue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'marketplace.offer.stockRestore' })
      );
    });

    it('should NOT enqueue on a re-poll of an already-cancelled order', async () => {
      orderSource.getOrder.mockResolvedValue(cancelledIncoming);
      orderRecordService.getOrderRecord.mockResolvedValue({
        sourceConnectionId: connectionId,
        orderSnapshot: { status: 'cancelled' },
      } as unknown as OrderRecord);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(jobQueue.enqueue).not.toHaveBeenCalled();
    });

    it('should NOT enqueue when the order status is not cancelled', async () => {
      orderSource.getOrder.mockResolvedValue({ ...cancelledIncoming, status: 'BOUGHT' });
      orderRecordService.getOrderRecord.mockResolvedValue(null);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(jobQueue.enqueue).not.toHaveBeenCalled();
    });

    it('should not fail order sync when the stockRestore enqueue fails (loss is logged, not thrown)', async () => {
      orderSource.getOrder.mockResolvedValue(cancelledIncoming);
      orderRecordService.getOrderRecord.mockResolvedValue({
        sourceConnectionId: connectionId,
        orderSnapshot: { status: 'BOUGHT' },
      } as unknown as OrderRecord);
      // The early-fire enqueue attempt fails; the second (post-persistOrder) succeeds.
      jobQueue.enqueue.mockRejectedValueOnce(new Error('redis down'));

      await expect(
        service.syncOrderFromSource(connectionId, externalOrderId)
      ).resolves.not.toThrow();

      // 2 calls: early-fire (fails, swallowed) + post-persistOrder (succeeds).
      expect(jobQueue.enqueue).toHaveBeenCalledTimes(2);
      // Order is still persisted regardless of the early-fire failure.
      expect(orderRecordService.persistOrder).toHaveBeenCalled();
    });

    it('should NOT enqueue on a destination-echo order (cross-origin early-return)', async () => {
      orderSource.getOrder.mockResolvedValue(cancelledIncoming);
      // Existing record originated from a DIFFERENT connection → early-return.
      orderRecordService.getOrderRecord.mockResolvedValue({
        sourceConnectionId: 'other-connection',
        orderSnapshot: { status: 'BOUGHT' },
      } as unknown as OrderRecord);

      const result = await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(result).toEqual([]);
      expect(jobQueue.enqueue).not.toHaveBeenCalled();
      expect(orderRecordService.persistOrder).not.toHaveBeenCalled();
    });

    it('should enqueue stockRestore even when item resolution fails (early-fire, #1146)', async () => {
      // Cancelled order with an unresolvable item — MissingOrderItemMappingError is
      // thrown at Step 4 before persistOrder can run, which would have preempted the
      // original post-persistOrder hook. The early-fire hook must still enqueue.
      const cancelledWithItems = {
        ...cancelledIncoming,
        items: [
          {
            id: 'item-x',
            productRef: { type: 'offer' as const, externalId: 'unmapped-offer' },
            quantity: 1,
            price: 9.99,
          },
        ],
      };
      orderSource.getOrder.mockResolvedValue(cancelledWithItems);
      orderRecordService.getOrderRecord.mockResolvedValue({
        sourceConnectionId: connectionId,
        orderSnapshot: { status: 'BOUGHT' },
      } as unknown as OrderRecord);
      orderItemRefResolver.tryResolve.mockResolvedValue({
        resolved: false,
        productRef: { type: 'offer', externalId: 'unmapped-offer' },
        reason: 'no mapping',
      });

      await expect(
        service.syncOrderFromSource(connectionId, externalOrderId)
      ).rejects.toBeInstanceOf(MissingOrderItemMappingError);

      expect(jobQueue.enqueue).toHaveBeenCalledTimes(1);
      expect(jobQueue.enqueue).toHaveBeenCalledWith({
        type: 'marketplace.offer.stockRestore',
        connectionId,
        payload: { schemaVersion: 1, internalOrderId },
        options: { dedupeKey },
      });
      expect(orderRecordService.persistOrder).not.toHaveBeenCalled();
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

    it('should resolve customer via email when customerEmail is present but customerExternalId is absent (#1208/#995)', async () => {
      orderSource.getOrder.mockResolvedValueOnce({
        ...baseIncoming,
        customerEmail: 'erli-buyer@example.com',
      });
      integrationsService.getCapabilityAdapter.mockResolvedValue(orderSource);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      // Email-only source: the email is the connection-scoped buyer-identity key.
      expect(customerIdentityResolver.resolveCustomerIdentity).toHaveBeenCalledWith({
        externalBuyerId: 'erli-buyer@example.com',
        email: 'erli-buyer@example.com',
        sourceConnectionId: connectionId,
      });
      // The Customer mapping is NOT created directly — resolution goes through
      // the identity resolver, which owns the Customer-mapping write.
      expect(identifierMapping.getOrCreateInternalId).not.toHaveBeenCalledWith(
        'Customer',
        expect.anything(),
        expect.anything(),
        expect.anything()
      );
      // The resolved internal customer id flows onto the persisted snapshot, so
      // the destination order-create has a customerId (the bug fix).
      expect(orderRecordService.persistIncomingSnapshot).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'ol_customer_test',
        connectionId,
        null
      );
    });

    it('should return undefined customer when neither customerExternalId nor customerEmail is present', async () => {
      orderSource.getOrder.mockResolvedValueOnce({ ...baseIncoming });
      integrationsService.getCapabilityAdapter.mockResolvedValue(orderSource);

      await service.syncOrderFromSource(connectionId, externalOrderId);

      expect(customerIdentityResolver.resolveCustomerIdentity).not.toHaveBeenCalled();
      expect(identifierMapping.getOrCreateInternalId).not.toHaveBeenCalledWith(
        'Customer',
        expect.anything(),
        expect.anything(),
        expect.anything()
      );
      expect(orderRecordService.persistIncomingSnapshot).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        null,
        connectionId,
        null
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

  describe('syncOrderFromSource – inbound cancellation (#1158 / #1132)', () => {
    const externalOrderId = 'checkout-cancel-1';

    it('relays a cancel to the order destinations and does NOT re-run the create path', async () => {
      identifierMapping.getInternalId.mockResolvedValue('ol_order_cancel');
      orderRecordService.getOrderRecord.mockResolvedValue({
        sourceConnectionId: connectionId,
      } as unknown as OrderRecord);
      orderLifecycleRelay.relay.mockResolvedValue({
        targets: [{ connectionId: 'dest-conn-1', outcome: 'applied' }],
      });

      const result = await service.syncOrderFromSource(
        connectionId,
        externalOrderId,
        'evt-1',
        'cancelled'
      );

      expect(result).toEqual([]);
      expect(orderLifecycleRelay.relay).toHaveBeenCalledWith({
        internalOrderId: 'ol_order_cancel',
        originConnectionId: connectionId,
        event: { type: 'cancelled' },
      });
      // Must NOT hydrate or re-create the order (the #1132 bug was re-creating it).
      expect(orderSource.getOrder).not.toHaveBeenCalled();
      expect(orderRecordService.persistIncomingSnapshot).not.toHaveBeenCalled();
      expect(orderRecordService.persistOrder).not.toHaveBeenCalled();
      expect(orderSyncService.syncOrder).not.toHaveBeenCalled();
    });

    it('does nothing when the cancelled order was never ingested (no internal mapping)', async () => {
      identifierMapping.getInternalId.mockResolvedValue(null);

      const result = await service.syncOrderFromSource(
        connectionId,
        externalOrderId,
        'evt-1',
        'cancelled'
      );

      expect(result).toEqual([]);
      expect(orderLifecycleRelay.relay).not.toHaveBeenCalled();
    });

    it('skips the relay for a destination-echo cancel (order originates from another connection)', async () => {
      identifierMapping.getInternalId.mockResolvedValue('ol_order_cancel');
      orderRecordService.getOrderRecord.mockResolvedValue({
        sourceConnectionId: 'allegro-connection',
      } as unknown as OrderRecord);

      const result = await service.syncOrderFromSource(
        connectionId,
        externalOrderId,
        'evt-1',
        'cancelled'
      );

      expect(result).toEqual([]);
      expect(orderLifecycleRelay.relay).not.toHaveBeenCalled();
    });

    it('logs at warn when a destination rejects the cancel (e.g. already shipped)', async () => {
      const warnSpy = jest.spyOn(service['logger'], 'warn');
      identifierMapping.getInternalId.mockResolvedValue('ol_order_cancel');
      orderRecordService.getOrderRecord.mockResolvedValue({
        sourceConnectionId: connectionId,
      } as unknown as OrderRecord);
      orderLifecycleRelay.relay.mockResolvedValue({
        targets: [
          { connectionId: 'dest-conn-1', outcome: 'rejected', detail: 'order already shipped' },
        ],
      });

      await service.syncOrderFromSource(connectionId, externalOrderId, 'evt-1', 'cancelled');

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('dest-conn-1=rejected'));
    });
  });
});
