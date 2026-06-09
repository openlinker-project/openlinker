/**
 * Order Sync Service Tests
 *
 * Unit tests for OrderSyncService. Covers single-destination, multi-destination,
 * partial-failure, and self-route exclusion behavior.
 *
 * @module libs/core/src/orders/application/services/__tests__
 */
import { OrderSyncService } from '../order-sync.service';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { OrderProcessorManagerPort } from '../../../domain/ports/order-processor-manager.port';
import type { OrderSyncRequest } from '../../interfaces/order-sync.service.interface';
import type { Order } from '../../../domain/types/order.types';
import type { OrderRef } from '../../../domain/types/order-processor.types';
import type { IMappingConfigService } from '@openlinker/core/mappings';
import { NoOrderDestinationsAvailableException } from '../../../domain/exceptions/no-order-destinations-available.exception';
import { OrderCreateContendedException } from '../../../domain/exceptions/order-create-contended.exception';
import type { SyncLockPort } from '@openlinker/core/sync';
import type { IIdentifierMappingService } from '@openlinker/core/identifier-mapping';
import {
  DuplicateIdentifierMappingError,
  MappingAlreadyExistsError,
} from '@openlinker/core/identifier-mapping';

describe('OrderSyncService', () => {
  let service: OrderSyncService;
  let integrationsService: jest.Mocked<IIntegrationsService>;
  let mappingConfigService: jest.Mocked<IMappingConfigService>;
  let syncLock: jest.Mocked<SyncLockPort>;
  let identifierMapping: jest.Mocked<IIdentifierMappingService>;

  const makeAdapter = (orderRef: OrderRef = { orderId: 'dest_order' }) =>
    ({
      createOrder: jest.fn().mockResolvedValue(orderRef),
    }) as unknown as jest.Mocked<OrderProcessorManagerPort>;

  const registerDestinations = (
    destinations: Array<{ connectionId: string; adapter: OrderProcessorManagerPort }>
  ): void => {
    integrationsService.listCapabilityAdapters.mockResolvedValue(
      destinations.map(({ connectionId, adapter }) => ({
        connectionId,
        connection: { id: connectionId } as never,
        adapter,
        metadata: {} as never,
      }))
    );
  };

  const createOrder = (): Order => ({
    id: 'ol_order_123',
    orderNumber: 'ORDER-001',
    status: 'processing',
    customerId: 'ol_customer_456',
    items: [
      {
        id: 'item-1',
        productId: 'ol_product_789',
        quantity: 2,
        price: 29.99,
        sku: 'SKU-001',
      },
    ],
    totals: {
      subtotal: 59.98,
      tax: 0,
      shipping: 5.0,
      total: 64.98,
      currency: 'PLN',
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  beforeEach(() => {
    integrationsService = {
      getCapabilityAdapter: jest.fn(),
      getAdapter: jest.fn(),
      listCapabilityAdapters: jest.fn().mockResolvedValue([]),
      resolveAdapterMetadata: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;

    mappingConfigService = {
      getStatusMappings: jest.fn().mockResolvedValue([]),
      upsertStatusMappings: jest.fn().mockResolvedValue([]),
      getCarrierMappings: jest.fn().mockResolvedValue([]),
      upsertCarrierMappings: jest.fn().mockResolvedValue([]),
      getPaymentMappings: jest.fn().mockResolvedValue([]),
      upsertPaymentMappings: jest.fn().mockResolvedValue([]),
      resolveStatusMapping: jest.fn().mockResolvedValue(null),
      resolveCarrierMapping: jest.fn().mockResolvedValue(null),
      getOrderStateMappings: jest.fn().mockResolvedValue([]),
      upsertOrderStateMappings: jest.fn().mockResolvedValue([]),
      resolveOrderStateMapping: jest.fn().mockResolvedValue(null),
      getCategoryMappings: jest.fn(),
      upsertCategoryMapping: jest.fn(),
      deleteCategoryMapping: jest.fn(),
      resolveAllegroCategory: jest.fn(),
    } as jest.Mocked<IMappingConfigService>;

    syncLock = {
      acquire: jest.fn().mockResolvedValue('lock-token'),
      release: jest.fn().mockResolvedValue(true),
    } as jest.Mocked<SyncLockPort>;

    identifierMapping = {
      getOrCreateInternalId: jest.fn(),
      getInternalId: jest.fn(),
      getExternalIds: jest.fn().mockResolvedValue([]),
      createMapping: jest.fn(),
      batchGetOrCreateInternalIds: jest.fn(),
    } as unknown as jest.Mocked<IIdentifierMappingService>;

    service = new OrderSyncService(
      integrationsService,
      mappingConfigService,
      syncLock,
      identifierMapping
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('syncOrder', () => {
    it('should sync to a single destination and return a success result', async () => {
      const adapter = makeAdapter({ orderId: 'dest_order_789', orderNumber: 'DEST-001' });
      registerDestinations([{ connectionId: 'dest-a', adapter }]);

      const request: OrderSyncRequest = {
        order: createOrder(),
        sourceConnectionId: 'source-1',
        sourceEventId: 'event-456',
      };

      const results = await service.syncOrder(request);

      expect(adapter.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          orderNumber: 'ORDER-001',
          source: { connectionId: 'source-1', eventId: 'event-456' },
          // #970 B1: core passes the internal order id so destination adapters
          // can write a platform-side dedup guard.
          metadata: expect.objectContaining({ internalOrderId: 'ol_order_123' }),
        })
      );
      expect(results).toEqual([
        {
          destinationConnectionId: 'dest-a',
          status: 'success',
          orderRef: { orderId: 'dest_order_789', orderNumber: 'DEST-001' },
        },
      ]);
    });

    it('should not re-create the destination order when a prior trigger already ingested it (webhook/poll convergence, #904)', async () => {
      // Both the low-latency webhook (#902/#903) and the reconciliation poll
      // (#904) reach syncOrder. When a prior trigger already created + mapped
      // the order, the second trigger must skip create — exactly one ingest.
      const adapter = makeAdapter({ orderId: 'should-not-be-used' });
      registerDestinations([{ connectionId: 'dest-a', adapter }]);
      identifierMapping.getExternalIds.mockResolvedValue([
        {
          entityType: 'Order',
          externalId: 'PS-EXISTING-1',
          connectionId: 'dest-a',
          platformType: 'prestashop',
        },
      ]);

      const results = await service.syncOrder({
        order: createOrder(),
        sourceConnectionId: 'source-1',
        sourceEventId: 'poll-event-1',
      });

      expect(adapter.createOrder).not.toHaveBeenCalled();
      expect(results).toEqual([
        {
          destinationConnectionId: 'dest-a',
          status: 'success',
          orderRef: { orderId: 'PS-EXISTING-1' },
        },
      ]);
    });

    it('should fan out to every destination processor', async () => {
      const a = makeAdapter({ orderId: 'a-1' });
      const b = makeAdapter({ orderId: 'b-1' });
      registerDestinations([
        { connectionId: 'dest-a', adapter: a },
        { connectionId: 'dest-b', adapter: b },
      ]);

      const results = await service.syncOrder({
        order: createOrder(),
        sourceConnectionId: 'source-1',
      });

      expect(a.createOrder).toHaveBeenCalledTimes(1);
      expect(b.createOrder).toHaveBeenCalledTimes(1);
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.status === 'success')).toBe(true);
    });

    it('should persist the destination external↔internal mapping for every destination', async () => {
      const a = makeAdapter({ orderId: 'a-1' });
      const b = makeAdapter({ orderId: 'b-1' });
      registerDestinations([
        { connectionId: 'dest-a', adapter: a },
        { connectionId: 'dest-b', adapter: b },
      ]);

      await service.syncOrder({
        order: createOrder(),
        sourceConnectionId: 'source-1',
      });

      // Core owns the mapping write (#909): one per destination, keyed by the
      // adapter-returned external id → the internal order id.
      expect(identifierMapping.createMapping).toHaveBeenCalledWith(
        'Order',
        'a-1',
        'dest-a',
        'ol_order_123',
        expect.any(Object)
      );
      expect(identifierMapping.createMapping).toHaveBeenCalledWith(
        'Order',
        'b-1',
        'dest-b',
        'ol_order_123',
        expect.any(Object)
      );
    });

    it('should isolate partial failures and still report successful destinations', async () => {
      const ok = makeAdapter({ orderId: 'ok-1' });
      const failing = {
        createOrder: jest.fn().mockRejectedValue(new Error('destination down')),
      } as unknown as jest.Mocked<OrderProcessorManagerPort>;
      registerDestinations([
        { connectionId: 'dest-ok', adapter: ok },
        { connectionId: 'dest-bad', adapter: failing },
      ]);

      const results = await service.syncOrder({
        order: createOrder(),
        sourceConnectionId: 'source-1',
      });

      expect(results).toHaveLength(2);
      const okResult = results.find((r) => r.destinationConnectionId === 'dest-ok');
      const badResult = results.find((r) => r.destinationConnectionId === 'dest-bad');
      expect(okResult).toEqual({
        destinationConnectionId: 'dest-ok',
        status: 'success',
        orderRef: { orderId: 'ok-1' },
      });
      expect(badResult).toEqual({
        destinationConnectionId: 'dest-bad',
        status: 'failed',
        error: { message: 'destination down' },
      });
    });

    it('should exclude the source connection from destinations', async () => {
      const selfAdapter = makeAdapter();
      const otherAdapter = makeAdapter({ orderId: 'other-1' });
      registerDestinations([
        { connectionId: 'source-1', adapter: selfAdapter },
        { connectionId: 'dest-other', adapter: otherAdapter },
      ]);

      const results = await service.syncOrder({
        order: createOrder(),
        sourceConnectionId: 'source-1',
      });

      expect(selfAdapter.createOrder).not.toHaveBeenCalled();
      expect(otherAdapter.createOrder).toHaveBeenCalledTimes(1);
      expect(results).toHaveLength(1);
      expect(results[0].destinationConnectionId).toBe('dest-other');
    });

    it('should throw when no destinations are available', async () => {
      registerDestinations([]);

      await expect(
        service.syncOrder({
          order: createOrder(),
          sourceConnectionId: 'source-1',
        })
      ).rejects.toThrow(NoOrderDestinationsAvailableException);
    });

    it('should attach internalOrderId and sourceConnectionId to the thrown exception', async () => {
      registerDestinations([]);
      const order = createOrder();

      let caught: unknown;
      try {
        await service.syncOrder({ order, sourceConnectionId: 'source-1' });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(NoOrderDestinationsAvailableException);
      const exception = caught as NoOrderDestinationsAvailableException;
      expect(exception.internalOrderId).toBe(order.id);
      expect(exception.sourceConnectionId).toBe('source-1');
    });

    it('should throw when the only available destination is the source connection', async () => {
      registerDestinations([{ connectionId: 'source-1', adapter: makeAdapter() }]);

      await expect(
        service.syncOrder({
          order: createOrder(),
          sourceConnectionId: 'source-1',
        })
      ).rejects.toThrow(NoOrderDestinationsAvailableException);
    });

    it('should use resolved status from mapping config when a mapping exists', async () => {
      const adapter = makeAdapter();
      registerDestinations([{ connectionId: 'dest-a', adapter }]);
      mappingConfigService.resolveStatusMapping.mockResolvedValue('processing');

      const order = createOrder();
      order.status = 'READY_FOR_PROCESSING';

      await service.syncOrder({ order, sourceConnectionId: 'source-1' });

      expect(mappingConfigService.resolveStatusMapping).toHaveBeenCalledWith(
        'source-1',
        'READY_FOR_PROCESSING'
      );
      expect(adapter.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'processing' })
      );
    });

    it('should fall back to order status when no mapping is configured', async () => {
      const adapter = makeAdapter();
      registerDestinations([{ connectionId: 'dest-a', adapter }]);

      const order = createOrder();
      order.status = 'shipped';

      await service.syncOrder({ order, sourceConnectionId: 'source-1' });

      expect(adapter.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'shipped' })
      );
    });

    it('should default to pending for unknown order status', async () => {
      const adapter = makeAdapter();
      registerDestinations([{ connectionId: 'dest-a', adapter }]);

      const order = createOrder();
      order.status = 'unknown_status';

      await service.syncOrder({ order, sourceConnectionId: 'source-1' });

      expect(adapter.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'pending' })
      );
    });

    it('should propagate mapping service errors', async () => {
      registerDestinations([{ connectionId: 'dest-a', adapter: makeAdapter() }]);
      mappingConfigService.resolveStatusMapping.mockRejectedValue(
        new Error('Mapping service unavailable')
      );

      await expect(
        service.syncOrder({ order: createOrder(), sourceConnectionId: 'source-1' })
      ).rejects.toThrow('Mapping service unavailable');
    });
  });

  describe('createOrder idempotency (lock)', () => {
    it('should acquire the per-(order, destination) lock and release it after create', async () => {
      const adapter = makeAdapter({ orderId: 'dest-1' });
      registerDestinations([{ connectionId: 'dest-a', adapter }]);

      await service.syncOrder({ order: createOrder(), sourceConnectionId: 'source-1' });

      expect(syncLock.acquire).toHaveBeenCalledWith('order:create:dest-a:ol_order_123', 120000);
      expect(adapter.createOrder).toHaveBeenCalledTimes(1);
      expect(syncLock.release).toHaveBeenCalledWith(
        'order:create:dest-a:ol_order_123',
        'lock-token'
      );
    });

    it('should skip create and synthesize the ref from the mapping when the lock is held but the order already exists', async () => {
      const adapter = makeAdapter({ orderId: 'should-not-be-used' });
      registerDestinations([{ connectionId: 'dest-a', adapter }]);
      syncLock.acquire.mockResolvedValue(null);
      identifierMapping.getExternalIds.mockResolvedValue([
        {
          externalId: 'PS-EXISTING-42',
          connectionId: 'dest-a',
          platformType: 'prestashop',
          entityType: 'Order',
        },
      ]);

      const results = await service.syncOrder({
        order: createOrder(),
        sourceConnectionId: 'source-1',
      });

      expect(adapter.createOrder).not.toHaveBeenCalled();
      expect(results).toEqual([
        {
          destinationConnectionId: 'dest-a',
          status: 'success',
          orderRef: { orderId: 'PS-EXISTING-42' },
        },
      ]);
    });

    it('should throw OrderCreateContendedException (retryable) when the lock is held and no mapping exists yet', async () => {
      const adapter = makeAdapter();
      registerDestinations([{ connectionId: 'dest-a', adapter }]);
      syncLock.acquire.mockResolvedValue(null);
      identifierMapping.getExternalIds.mockResolvedValue([]);

      await expect(
        service.syncOrder({ order: createOrder(), sourceConnectionId: 'source-1' })
      ).rejects.toBeInstanceOf(OrderCreateContendedException);
      expect(adapter.createOrder).not.toHaveBeenCalled();
    });

    it('should not mask a successful create when releasing the lock fails', async () => {
      const adapter = makeAdapter({ orderId: 'dest-1' });
      registerDestinations([{ connectionId: 'dest-a', adapter }]);
      syncLock.release.mockRejectedValue(new Error('redis down'));

      const results = await service.syncOrder({
        order: createOrder(),
        sourceConnectionId: 'source-1',
      });

      expect(results).toEqual([
        { destinationConnectionId: 'dest-a', status: 'success', orderRef: { orderId: 'dest-1' } },
      ]);
    });

    it('should rethrow contention (aborting the whole job) even when another destination succeeds', async () => {
      const ok = makeAdapter({ orderId: 'ok-1' });
      const contended = makeAdapter({ orderId: 'never' });
      registerDestinations([
        { connectionId: 'dest-ok', adapter: ok },
        { connectionId: 'dest-contended', adapter: contended },
      ]);
      // dest-contended cannot acquire the lock and no mapping exists yet → contended
      syncLock.acquire.mockImplementation((key: string) =>
        Promise.resolve(key.includes('dest-contended') ? null : 'lock-token')
      );
      identifierMapping.getExternalIds.mockResolvedValue([]);

      await expect(
        service.syncOrder({ order: createOrder(), sourceConnectionId: 'source-1' })
      ).rejects.toBeInstanceOf(OrderCreateContendedException);
      // the uncontended destination still attempted its create under its own lock
      expect(ok.createOrder).toHaveBeenCalledTimes(1);
      expect(contended.createOrder).not.toHaveBeenCalled();
    });

    it('should rethrow contention rather than a sibling genuine failure', async () => {
      const failing = {
        createOrder: jest.fn().mockRejectedValue(new Error('destination down')),
      } as unknown as jest.Mocked<OrderProcessorManagerPort>;
      const contended = makeAdapter({ orderId: 'never' });
      registerDestinations([
        { connectionId: 'dest-fail', adapter: failing },
        { connectionId: 'dest-contended', adapter: contended },
      ]);
      syncLock.acquire.mockImplementation((key: string) =>
        Promise.resolve(key.includes('dest-contended') ? null : 'lock-token')
      );
      identifierMapping.getExternalIds.mockResolvedValue([]);

      await expect(
        service.syncOrder({ order: createOrder(), sourceConnectionId: 'source-1' })
      ).rejects.toBeInstanceOf(OrderCreateContendedException);
    });

    it('should create then persist the mapping with the external id when the lock is acquired and no prior mapping exists', async () => {
      const adapter = makeAdapter({ orderId: 'PS-999', orderNumber: 'DEST-1' });
      registerDestinations([{ connectionId: 'dest-a', adapter }]);
      identifierMapping.getExternalIds.mockResolvedValue([]);

      const results = await service.syncOrder({
        order: createOrder(),
        sourceConnectionId: 'source-1',
      });

      expect(adapter.createOrder).toHaveBeenCalledTimes(1);
      expect(identifierMapping.createMapping).toHaveBeenCalledWith(
        'Order',
        'PS-999',
        'dest-a',
        'ol_order_123',
        expect.any(Object)
      );
      expect(results[0]).toMatchObject({
        status: 'success',
        orderRef: { orderId: 'PS-999', orderNumber: 'DEST-1' },
      });
    });

    it('should skip create when the lock is acquired but a prior run already mapped the order', async () => {
      const adapter = makeAdapter({ orderId: 'should-not-be-used' });
      registerDestinations([{ connectionId: 'dest-a', adapter }]);
      // Lock acquired (default 'lock-token'), but the destination mapping
      // already exists from a prior completed run.
      identifierMapping.getExternalIds.mockResolvedValue([
        {
          externalId: 'PS-EXISTING-7',
          connectionId: 'dest-a',
          platformType: 'prestashop',
          entityType: 'Order',
        },
      ]);

      const results = await service.syncOrder({
        order: createOrder(),
        sourceConnectionId: 'source-1',
      });

      expect(adapter.createOrder).not.toHaveBeenCalled();
      expect(identifierMapping.createMapping).not.toHaveBeenCalled();
      expect(results[0]).toMatchObject({
        status: 'success',
        orderRef: { orderId: 'PS-EXISTING-7' },
      });
      // Lock must still be released on the skip path.
      expect(syncLock.release).toHaveBeenCalledWith(
        'order:create:dest-a:ol_order_123',
        'lock-token'
      );
    });

    // Both arms of persistDestinationMapping's catch are exercised: the
    // unique-constraint race (DuplicateIdentifierMappingError) and the
    // read-before-write race (MappingAlreadyExistsError). Either resolves to an
    // idempotent success returning the adapter's external id.
    it.each([
      ['DuplicateIdentifierMappingError', new DuplicateIdentifierMappingError('Order', 'PS-555', 'prestashop', 'dest-a')],
      ['MappingAlreadyExistsError', new MappingAlreadyExistsError('Order', 'PS-555', 'dest-a', 'ol_order_123')],
    ])('should swallow %s from createMapping (concurrent create resolved)', async (_label, error) => {
      const adapter = makeAdapter({ orderId: 'PS-555' });
      registerDestinations([{ connectionId: 'dest-a', adapter }]);
      identifierMapping.getExternalIds.mockResolvedValue([]);
      identifierMapping.createMapping.mockRejectedValue(error);

      const results = await service.syncOrder({
        order: createOrder(),
        sourceConnectionId: 'source-1',
      });

      expect(results[0]).toMatchObject({
        status: 'success',
        orderRef: { orderId: 'PS-555' },
      });
    });
  });
});
