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
import type { IOrderRecordService } from '../../interfaces/order-record.service.interface';
import type { IOrderHoldService } from '../../interfaces/order-hold.service.interface';
import type { OrderRecord } from '../../../domain/entities/order-record.entity';
import type { OrderHold } from '../../../domain/entities/order-hold.entity';
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
  let orderRecordService: jest.Mocked<IOrderRecordService>;
  let orderHoldService: jest.Mocked<IOrderHoldService>;

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
      resolveDestinationCategory: jest.fn(),
      getAttributeMappings: jest.fn(),
      getAttributeMappingsByProvenance: jest.fn(),
      upsertAttributeMapping: jest.fn(),
      deleteAttributeMapping: jest.fn(),
      getAttributeMappingRules: jest.fn(),
      upsertAttributeMappingRule: jest.fn(),
      deleteAttributeMappingRule: jest.fn(),
    } as jest.Mocked<IMappingConfigService>;

    syncLock = {
      acquire: jest.fn().mockResolvedValue('lock-token'),
      release: jest.fn().mockResolvedValue(true),
      extend: jest.fn().mockResolvedValue(true),
    } as jest.Mocked<SyncLockPort>;

    identifierMapping = {
      getOrCreateInternalId: jest.fn(),
      getInternalId: jest.fn(),
      getExternalIds: jest.fn().mockResolvedValue([]),
      createMapping: jest.fn(),
      batchGetOrCreateInternalIds: jest.fn(),
    } as unknown as jest.Mocked<IIdentifierMappingService>;

    orderRecordService = {
      getOrderRecord: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<IOrderRecordService>;

    orderHoldService = {
      getOpenHold: jest.fn().mockResolvedValue(null),
      place: jest.fn(),
      release: jest.fn(),
      listHolds: jest.fn(),
    } as unknown as jest.Mocked<IOrderHoldService>;

    service = new OrderSyncService(
      integrationsService,
      mappingConfigService,
      syncLock,
      identifierMapping,
      orderRecordService,
      orderHoldService
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

    it('should pass the source payment status through to the destination (#2600)', async () => {
      // A destination cannot tell a cash-on-delivery order from a prepaid one
      // without this, and there is nothing else on the contract that says so.
      const adapter = makeAdapter();
      registerDestinations([{ connectionId: 'dest-a', adapter }]);

      const order = createOrder();
      order.paymentStatus = 'cod';

      await service.syncOrder({ order, sourceConnectionId: 'source-1' });

      expect(adapter.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({ paymentStatus: 'cod' })
      );
    });

    it('should leave the payment status absent when the source reported none (#2600)', async () => {
      const adapter = makeAdapter();
      registerDestinations([{ connectionId: 'dest-a', adapter }]);

      const order = createOrder();
      expect(order.paymentStatus).toBeUndefined();

      await service.syncOrder({ order, sourceConnectionId: 'source-1' });

      const created = adapter.createOrder.mock.calls[0][0];
      expect(created.paymentStatus).toBeUndefined();
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
      [
        'DuplicateIdentifierMappingError',
        new DuplicateIdentifierMappingError('Order', 'PS-555', 'prestashop', 'dest-a'),
      ],
      [
        'MappingAlreadyExistsError',
        new MappingAlreadyExistsError('Order', 'PS-555', 'dest-a', 'ol_order_123'),
      ],
    ])(
      'should swallow %s from createMapping (concurrent create resolved)',
      async (_label, error) => {
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
      }
    );
  });

  // #2339 — the hold gate (story L4: "a held order never reaches the
  // destination shop").
  describe('held orders', () => {
    const openHold = {
      id: 'hold-1',
      internalOrderId: 'order-123',
      reason: 'stock-shortfall',
    } as unknown as OrderHold;

    it('should withhold provisioning from every destination when the order is on hold', async () => {
      const adapterA = makeAdapter();
      const adapterB = makeAdapter();
      registerDestinations([
        { connectionId: 'dest-a', adapter: adapterA },
        { connectionId: 'dest-b', adapter: adapterB },
      ]);
      orderHoldService.getOpenHold.mockResolvedValue(openHold);

      const results = await service.syncOrder({
        order: createOrder(),
        sourceConnectionId: 'source-1',
      });

      expect(results).toEqual([
        {
          destinationConnectionId: 'dest-a',
          status: 'skipped_held',
          holdId: 'hold-1',
          holdReason: 'stock-shortfall',
        },
        {
          destinationConnectionId: 'dest-b',
          status: 'skipped_held',
          holdId: 'hold-1',
          holdReason: 'stock-shortfall',
        },
      ]);
      expect(adapterA.createOrder).not.toHaveBeenCalled();
      expect(adapterB.createOrder).not.toHaveBeenCalled();
      expect(syncLock.acquire).not.toHaveBeenCalled();
      expect(identifierMapping.createMapping).not.toHaveBeenCalled();
    });

    it('should provision on the next run once the hold is released, with no manual step', async () => {
      const adapter = makeAdapter({ orderId: 'dest_order_1' });
      registerDestinations([{ connectionId: 'dest-a', adapter }]);
      orderHoldService.getOpenHold.mockResolvedValueOnce(openHold);

      const held = await service.syncOrder({
        order: createOrder(),
        sourceConnectionId: 'source-1',
      });
      expect(held[0]).toMatchObject({ status: 'skipped_held' });

      // Released: the very next run sees no open hold and proceeds. Nothing was
      // persisted as terminal, so there is nothing to un-do first.
      orderHoldService.getOpenHold.mockResolvedValue(null);
      const afterRelease = await service.syncOrder({
        order: createOrder(),
        sourceConnectionId: 'source-1',
      });

      expect(afterRelease[0]).toMatchObject({ status: 'success' });
      expect(adapter.createOrder).toHaveBeenCalledTimes(1);
    });

    it('should propagate a hold-read failure rather than provisioning a possibly-held order', async () => {
      const adapter = makeAdapter();
      registerDestinations([{ connectionId: 'dest-a', adapter }]);
      orderHoldService.getOpenHold.mockRejectedValue(new Error('db down'));

      await expect(
        service.syncOrder({ order: createOrder(), sourceConnectionId: 'source-1' })
      ).rejects.toThrow('db down');
      expect(adapter.createOrder).not.toHaveBeenCalled();
    });
  });

  // #2284 — the `WHERE cancelledAt IS NULL` provisioning predicate.
  describe('source-cancelled orders', () => {
    const cancelledAt = new Date('2026-08-01T10:00:00.000Z');
    const cancelledRecord = { isCancelled: true, cancelledAt } as unknown as OrderRecord;

    it('should skip destination provisioning when the order was cancelled at source', async () => {
      const adapterA = makeAdapter();
      const adapterB = makeAdapter();
      registerDestinations([
        { connectionId: 'dest-a', adapter: adapterA },
        { connectionId: 'dest-b', adapter: adapterB },
      ]);
      orderRecordService.getOrderRecord.mockResolvedValue(cancelledRecord);

      const results = await service.syncOrder({
        order: createOrder(),
        sourceConnectionId: 'source-1',
      });

      expect(results).toEqual([
        { destinationConnectionId: 'dest-a', status: 'skipped_cancelled', cancelledAt },
        { destinationConnectionId: 'dest-b', status: 'skipped_cancelled', cancelledAt },
      ]);
      expect(adapterA.createOrder).not.toHaveBeenCalled();
      expect(adapterB.createOrder).not.toHaveBeenCalled();
      expect(syncLock.acquire).not.toHaveBeenCalled();
      expect(identifierMapping.createMapping).not.toHaveBeenCalled();
    });

    it('should provision normally when the order record reports no cancellation', async () => {
      const adapter = makeAdapter({ orderId: 'dest_order_1' });
      registerDestinations([{ connectionId: 'dest-a', adapter }]);
      orderRecordService.getOrderRecord.mockResolvedValue({
        isCancelled: false,
        cancelledAt: null,
      } as unknown as OrderRecord);

      const results = await service.syncOrder({
        order: createOrder(),
        sourceConnectionId: 'source-1',
      });

      expect(results[0]).toMatchObject({ status: 'success' });
      expect(adapter.createOrder).toHaveBeenCalledTimes(1);
    });

    it('should provision when no order record exists (absence is not cancellation)', async () => {
      const adapter = makeAdapter({ orderId: 'dest_order_1' });
      registerDestinations([{ connectionId: 'dest-a', adapter }]);
      orderRecordService.getOrderRecord.mockResolvedValue(null);

      const results = await service.syncOrder({
        order: createOrder(),
        sourceConnectionId: 'source-1',
      });

      expect(results[0]).toMatchObject({ status: 'success' });
      expect(adapter.createOrder).toHaveBeenCalledTimes(1);
    });

    // A read failure must never fall through into a create: provisioning a
    // possibly-cancelled order is the worse outcome, so the throw propagates
    // and the sync job retries.
    it('should propagate a record-read failure instead of provisioning', async () => {
      const adapter = makeAdapter();
      registerDestinations([{ connectionId: 'dest-a', adapter }]);
      orderRecordService.getOrderRecord.mockRejectedValue(new Error('db down'));

      await expect(
        service.syncOrder({ order: createOrder(), sourceConnectionId: 'source-1' })
      ).rejects.toThrow('db down');
      expect(adapter.createOrder).not.toHaveBeenCalled();
    });

    // The guard sits AFTER the no-destinations throw, so a cancelled order with
    // no destinations still reports the configuration problem.
    it('should still throw NoOrderDestinationsAvailableException with zero destinations', async () => {
      registerDestinations([]);
      orderRecordService.getOrderRecord.mockResolvedValue(cancelledRecord);

      await expect(
        service.syncOrder({ order: createOrder(), sourceConnectionId: 'source-1' })
      ).rejects.toThrow(NoOrderDestinationsAvailableException);
    });
  });
  // ── Characterisation of the UNFILTERED fan-out (#2397) ────────────────────
  //
  // Written against, and passing on, the code as it stood BEFORE the router
  // filter existed. That ordering is the point: a characterisation test written
  // afterwards encodes the change rather than the behaviour it was supposed to
  // preserve. Nothing in this block may be edited when the filter lands — if it
  // needs an edit, the filter changed the default path and the claim
  // "absent field => byte-identical fan-out" is false.
  describe('unfiltered fan-out characterisation', () => {
    const FROZEN_NOW = new Date('2026-08-31T12:00:00.000Z');

    it('should resolve destinations with exactly one capability key and nothing else', async () => {
      const adapter = makeAdapter();
      registerDestinations([{ connectionId: 'dest-a', adapter }]);

      await service.syncOrder({ order: createOrder(), sourceConnectionId: 'source-1' });

      // Exactly one listing call, carrying exactly one key. The filter must be
      // applied to the RESULT, never pushed into the listing argument, or the
      // three conditions behind an empty result stop being distinguishable.
      expect(integrationsService.listCapabilityAdapters).toHaveBeenCalledTimes(1);
      const [listingArg] = integrationsService.listCapabilityAdapters.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(Object.keys(listingArg)).toEqual(['capability']);
      expect(listingArg).toStrictEqual({ capability: 'OrderProcessorManager' });
    });

    it('should hand the destination a byte-identical createOrder payload', async () => {
      jest.useFakeTimers().setSystemTime(FROZEN_NOW);
      try {
        const adapter = makeAdapter();
        registerDestinations([{ connectionId: 'dest-a', adapter }]);

        await service.syncOrder({
          order: createOrder(),
          sourceConnectionId: 'source-1',
          sourceEventId: 'event-456',
        });

        // toStrictEqual, not toEqual: it distinguishes an absent key from one
        // explicitly set to undefined, which is what makes this an assertion
        // about the payload's exact shape rather than about its populated half.
        expect(adapter.createOrder).toHaveBeenCalledTimes(1);
        expect(adapter.createOrder.mock.calls[0][0]).toStrictEqual({
          orderNumber: 'ORDER-001',
          status: 'processing',
          customerId: 'ol_customer_456',
          items: [
            {
              id: 'item-1',
              productId: 'ol_product_789',
              variantId: undefined,
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
            taxTreatment: undefined,
          },
          shippingAddress: undefined,
          billingAddress: undefined,
          shipping: undefined,
          pickupPoint: undefined,
          source: { connectionId: 'source-1', eventId: 'event-456' },
          paymentStatus: undefined,
          metadata: {
            internalOrderId: 'ol_order_123',
            syncedAt: FROZEN_NOW.toISOString(),
          },
        });
      } finally {
        jest.useRealTimers();
      }
    });

    it('should fan out to every eligible destination except the source', async () => {
      const a = makeAdapter({ orderId: 'ext-a' });
      const b = makeAdapter({ orderId: 'ext-b' });
      const self = makeAdapter({ orderId: 'ext-self' });
      registerDestinations([
        { connectionId: 'dest-a', adapter: a },
        { connectionId: 'source-1', adapter: self },
        { connectionId: 'dest-b', adapter: b },
      ]);

      const results = await service.syncOrder({
        order: createOrder(),
        sourceConnectionId: 'source-1',
      });

      expect(results.map((r) => r.destinationConnectionId)).toEqual(['dest-a', 'dest-b']);
      expect(self.createOrder).not.toHaveBeenCalled();
    });
  });

  // ── Router-filtered fan-out (#2397) ───────────────────────────────────────
  describe('router-filtered fan-out', () => {
    it('should narrow the fan-out to the destinations the router named', async () => {
      const a = makeAdapter({ orderId: 'ext-a' });
      const b = makeAdapter({ orderId: 'ext-b' });
      const c = makeAdapter({ orderId: 'ext-c' });
      registerDestinations([
        { connectionId: 'dest-a', adapter: a },
        { connectionId: 'dest-b', adapter: b },
        { connectionId: 'dest-c', adapter: c },
      ]);

      const results = await service.syncOrder({
        order: createOrder(),
        sourceConnectionId: 'source-1',
        destinationConnectionIds: ['dest-a', 'dest-c'],
      });

      expect(results.map((r) => r.destinationConnectionId)).toEqual(['dest-a', 'dest-c']);
      expect(b.createOrder).not.toHaveBeenCalled();
    });

    // Ruling 1. A deliberate empty routing decision is a NON-EVENT, not a
    // misconfiguration: it must not throw, because a core `orders` exception is
    // registered with no per-plugin retry classifier and is therefore retryable
    // — ~10 full re-runs of syncOrderFromSource ending in a dead job whose
    // lastError blames connection config for what the router chose.
    it('should return no results and never throw when the routing decision named nobody', async () => {
      const a = makeAdapter();
      registerDestinations([{ connectionId: 'dest-a', adapter: a }]);

      const results = await service.syncOrder({
        order: createOrder(),
        sourceConnectionId: 'source-1',
        destinationConnectionIds: [],
      });

      expect(results).toEqual([]);
      expect(a.createOrder).not.toHaveBeenCalled();
    });

    it('should warn, rather than stay silent, when the routing decision named nobody', async () => {
      const warn = jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
      registerDestinations([{ connectionId: 'dest-a', adapter: makeAdapter() }]);

      await service.syncOrder({
        order: createOrder(),
        sourceConnectionId: 'source-1',
        destinationConnectionIds: [],
      });

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('routing decision named no destination');
    });

    // Ruling 2/3. Condition (c): the router named a destination that is not
    // currently eligible. Distinct from (a) "nothing configured" and from (b)
    // "router chose nobody" — and a genuine new total-failure regression.
    it('should throw naming the unresolved ids when no named destination is eligible', async () => {
      registerDestinations([{ connectionId: 'dest-a', adapter: makeAdapter() }]);

      let caught: unknown;
      try {
        await service.syncOrder({
          order: createOrder(),
          sourceConnectionId: 'source-1',
          destinationConnectionIds: ['dest-offline'],
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(NoOrderDestinationsAvailableException);
      const exception = caught as NoOrderDestinationsAvailableException;
      expect(exception.unresolvedDestinationConnectionIds).toEqual(['dest-offline']);
      expect(exception.message).toContain('dest-offline');
    });

    it('should keep the unfiltered throw unchanged when nothing is configured at all', async () => {
      registerDestinations([]);

      let caught: unknown;
      try {
        await service.syncOrder({ order: createOrder(), sourceConnectionId: 'source-1' });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(NoOrderDestinationsAvailableException);
      // (a) names no ids — it is not a routing failure.
      expect(
        (caught as NoOrderDestinationsAvailableException).unresolvedDestinationConnectionIds
      ).toBeUndefined();
    });

    // Ruling 6. A narrowed fan-out is never silent, or an operator cannot tell
    // a working router from a broken connection.
    it('should warn naming the unresolved id when only some named destinations resolve', async () => {
      const warn = jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
      registerDestinations([{ connectionId: 'dest-a', adapter: makeAdapter() }]);

      const results = await service.syncOrder({
        order: createOrder(),
        sourceConnectionId: 'source-1',
        destinationConnectionIds: ['dest-a', 'dest-offline'],
      });

      expect(results.map((r) => r.destinationConnectionId)).toEqual(['dest-a']);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('dest-offline');
    });

    // A5. Source exclusion runs BEFORE the filter, so an id echoing the source
    // must not be reported as an unreachable connection.
    it('should not report a source-echo id as unresolved', async () => {
      const warn = jest.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
      registerDestinations([
        { connectionId: 'dest-a', adapter: makeAdapter() },
        { connectionId: 'source-1', adapter: makeAdapter() },
      ]);

      await service.syncOrder({
        order: createOrder(),
        sourceConnectionId: 'source-1',
        destinationConnectionIds: ['dest-a', 'source-1'],
      });

      const messages = warn.mock.calls.map((c) => String(c[0])).join(' | ');
      expect(messages).not.toContain('unresolved');
    });

    // Surfaced by the diff review: the exception must never name the SOURCE
    // connection as an unreachable destination. Routing an order back to where
    // it came from is a distinct router misconfiguration, and the message says
    // so instead of blaming a connection that is working perfectly well.
    it('should not blame the source connection when the routing decision named only it', async () => {
      registerDestinations([
        { connectionId: 'dest-a', adapter: makeAdapter() },
        { connectionId: 'source-1', adapter: makeAdapter() },
      ]);

      let caught: unknown;
      try {
        await service.syncOrder({
          order: createOrder(),
          sourceConnectionId: 'source-1',
          destinationConnectionIds: ['source-1'],
        });
      } catch (error) {
        caught = error;
      }

      const exception = caught as NoOrderDestinationsAvailableException;
      expect(exception).toBeInstanceOf(NoOrderDestinationsAvailableException);
      expect(exception.unresolvedDestinationConnectionIds).toEqual([]);
      expect(exception.message).toContain('named only the source connection');
      expect(exception.message).not.toContain('none of which is an active');
    });

    it('should name only the genuinely unreachable id when the decision mixes it with a source echo', async () => {
      registerDestinations([{ connectionId: 'dest-a', adapter: makeAdapter() }]);

      let caught: unknown;
      try {
        await service.syncOrder({
          order: createOrder(),
          sourceConnectionId: 'source-1',
          destinationConnectionIds: ['source-1', 'dest-offline', 'dest-offline'],
        });
      } catch (error) {
        caught = error;
      }

      const exception = caught as NoOrderDestinationsAvailableException;
      // Source echo excluded, duplicate deduped.
      expect(exception.unresolvedDestinationConnectionIds).toEqual(['dest-offline']);
      expect(exception.message).not.toContain('source-1,');
    });

    it('should treat duplicate ids idempotently and never fan out twice', async () => {
      const a = makeAdapter();
      registerDestinations([{ connectionId: 'dest-a', adapter: a }]);

      const results = await service.syncOrder({
        order: createOrder(),
        sourceConnectionId: 'source-1',
        destinationConnectionIds: ['dest-a', 'dest-a'],
      });

      expect(results).toHaveLength(1);
      expect(a.createOrder).toHaveBeenCalledTimes(1);
    });
  });

});
