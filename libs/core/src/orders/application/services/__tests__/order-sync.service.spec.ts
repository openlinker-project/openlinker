/**
 * Order Sync Service Tests
 *
 * Unit tests for OrderSyncService. Covers single-destination, multi-destination,
 * partial-failure, and self-route exclusion behavior.
 *
 * @module libs/core/src/orders/application/services/__tests__
 */
import { OrderSyncService } from '../order-sync.service';
import { IIntegrationsService } from '@openlinker/core/integrations/application/interfaces/integrations.service.interface';
import { OrderProcessorManagerPort } from '../../../domain/ports/order-processor-manager.port';
import { OrderSyncRequest } from '../../interfaces/order-sync.service.interface';
import { Order } from '../../../domain/types/order.types';
import { OrderRef } from '../../../domain/types/order-processor.types';
import { IMappingConfigService } from '@openlinker/core/mappings';
import { NoOrderDestinationsAvailableException } from '../../../domain/exceptions/no-order-destinations-available.exception';

describe('OrderSyncService', () => {
  let service: OrderSyncService;
  let integrationsService: jest.Mocked<IIntegrationsService>;
  let mappingConfigService: jest.Mocked<IMappingConfigService>;

  const makeAdapter = (orderRef: OrderRef = { orderId: 'dest_order' }) =>
    ({
      createOrder: jest.fn().mockResolvedValue(orderRef),
    }) as unknown as jest.Mocked<OrderProcessorManagerPort>;

  const registerDestinations = (
    destinations: Array<{ connectionId: string; adapter: OrderProcessorManagerPort }>,
  ): void => {
    integrationsService.listCapabilityAdapters.mockResolvedValue(
      destinations.map(({ connectionId, adapter }) => ({
        connectionId,
        connection: { id: connectionId } as never,
        adapter,
        metadata: {} as never,
      })),
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
      getCategoryMappings: jest.fn(),
      upsertCategoryMapping: jest.fn(),
      deleteCategoryMapping: jest.fn(),
      resolveAllegroCategory: jest.fn(),
    } as jest.Mocked<IMappingConfigService>;

    service = new OrderSyncService(integrationsService, mappingConfigService);
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
          metadata: expect.objectContaining({
            sourceConnectionId: 'source-1',
            sourceEventId: 'event-456',
            internalOrderId: 'ol_order_123',
          }),
        }),
      );
      expect(results).toEqual([
        {
          destinationConnectionId: 'dest-a',
          status: 'success',
          orderRef: { orderId: 'dest_order_789', orderNumber: 'DEST-001' },
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

    it('should propagate internalOrderId metadata to every destination', async () => {
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

      for (const adapter of [a, b]) {
        expect(adapter.createOrder).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: expect.objectContaining({ internalOrderId: 'ol_order_123' }),
          }),
        );
      }
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
        }),
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
        }),
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
        'READY_FOR_PROCESSING',
      );
      expect(adapter.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'processing' }),
      );
    });

    it('should fall back to order status when no mapping is configured', async () => {
      const adapter = makeAdapter();
      registerDestinations([{ connectionId: 'dest-a', adapter }]);

      const order = createOrder();
      order.status = 'shipped';

      await service.syncOrder({ order, sourceConnectionId: 'source-1' });

      expect(adapter.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'shipped' }),
      );
    });

    it('should default to pending for unknown order status', async () => {
      const adapter = makeAdapter();
      registerDestinations([{ connectionId: 'dest-a', adapter }]);

      const order = createOrder();
      order.status = 'unknown_status';

      await service.syncOrder({ order, sourceConnectionId: 'source-1' });

      expect(adapter.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'pending' }),
      );
    });

    it('should propagate mapping service errors', async () => {
      registerDestinations([{ connectionId: 'dest-a', adapter: makeAdapter() }]);
      mappingConfigService.resolveStatusMapping.mockRejectedValue(
        new Error('Mapping service unavailable'),
      );

      await expect(
        service.syncOrder({ order: createOrder(), sourceConnectionId: 'source-1' }),
      ).rejects.toThrow('Mapping service unavailable');
    });
  });
});
