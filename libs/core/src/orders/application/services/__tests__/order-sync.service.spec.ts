/**
 * Order Sync Service Tests
 *
 * Unit tests for OrderSyncService. Tests order routing, adapter resolution,
 * order creation, and error handling.
 *
 * @module libs/core/src/orders/application/services/__tests__
 */
import { OrderSyncService } from '../order-sync.service';
import { IIntegrationsService } from '@openlinker/core/integrations/application/interfaces/integrations.service.interface';
import { OrderProcessorManagerPort } from '../../../domain/ports/order-processor-manager.port';
import { OrderSyncRequest } from '../../interfaces/order-sync.service.interface';
import { Order } from '../../../domain/ports/order-source.port';
import { OrderRef } from '../../../domain/types/order-processor.types';
import { IMappingConfigService } from '@openlinker/core/mappings';

describe('OrderSyncService', () => {
  let service: OrderSyncService;
  let integrationsService: jest.Mocked<IIntegrationsService>;
  let processorAdapter: jest.Mocked<OrderProcessorManagerPort>;
  let mappingConfigService: jest.Mocked<IMappingConfigService>;

  const destinationConnectionId = 'destination-connection-123';
  const originalEnv = process.env.ORDER_SYNC_DESTINATION_CONNECTION_ID;

  beforeEach(() => {
    processorAdapter = {
      createOrder: jest.fn(),
    } as unknown as jest.Mocked<OrderProcessorManagerPort>;

    integrationsService = {
      getCapabilityAdapter: jest.fn().mockResolvedValue(processorAdapter),
      getAdapter: jest.fn(),
      listCapabilityAdapters: jest.fn(),
    } as unknown as jest.Mocked<IIntegrationsService>;

    mappingConfigService = {
      getStatusMappings: jest.fn().mockResolvedValue([]),
      upsertStatusMappings: jest.fn().mockResolvedValue([]),
      getCarrierMappings: jest.fn().mockResolvedValue([]),
      upsertCarrierMappings: jest.fn().mockResolvedValue([]),
      getPaymentMappings: jest.fn().mockResolvedValue([]),
      upsertPaymentMappings: jest.fn().mockResolvedValue([]),
      resolveStatusMapping: jest.fn().mockResolvedValue(null),
    } as jest.Mocked<IMappingConfigService>;

    // Set environment variable
    process.env.ORDER_SYNC_DESTINATION_CONNECTION_ID = destinationConnectionId;

    service = new OrderSyncService(integrationsService, mappingConfigService);
  });

  afterEach(() => {
    // Restore original environment variable
    if (originalEnv) {
      process.env.ORDER_SYNC_DESTINATION_CONNECTION_ID = originalEnv;
    } else {
      delete process.env.ORDER_SYNC_DESTINATION_CONNECTION_ID;
    }
  });

  describe('syncOrder', () => {
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
        shipping: 5.00,
        total: 64.98,
        currency: 'PLN',
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    it('should sync order successfully', async () => {
      const order = createOrder();
      const request: OrderSyncRequest = {
        order,
        sourceConnectionId: 'source-connection-123',
        sourceEventId: 'event-456',
      };

      const orderRef: OrderRef = {
        orderId: 'dest_order_789',
        orderNumber: 'DEST-001',
      };

      processorAdapter.createOrder.mockResolvedValue(orderRef);

      const results = await service.syncOrder(request);

      expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith(
        destinationConnectionId,
        'OrderProcessorManager',
      );
      expect(processorAdapter.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
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
            shipping: 5.00,
            total: 64.98,
            currency: 'PLN',
          },
          metadata: expect.objectContaining({
            sourceConnectionId: 'source-connection-123',
            sourceEventId: 'event-456',
          }),
        }),
      );
      expect(results).toEqual([
        {
          destinationConnectionId,
          orderRef,
        },
      ]);
    });

    it('should handle order without sourceEventId', async () => {
      const order = createOrder();
      const request: OrderSyncRequest = {
        order,
        sourceConnectionId: 'source-connection-123',
      };

      const orderRef: OrderRef = {
        orderId: 'dest_order_789',
      };

      processorAdapter.createOrder.mockResolvedValue(orderRef);

      const results = await service.syncOrder(request);

      expect(processorAdapter.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            sourceConnectionId: 'source-connection-123',
            sourceEventId: undefined,
          }),
        }),
      );
      expect(results).toHaveLength(1);
    });

    it('should validate and map order status', async () => {
      const order = createOrder();
      order.status = 'shipped';
      const request: OrderSyncRequest = {
        order,
        sourceConnectionId: 'source-connection-123',
      };

      processorAdapter.createOrder.mockResolvedValue({ orderId: 'dest_order_789' });

      await service.syncOrder(request);

      expect(processorAdapter.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'shipped',
        }),
      );
    });

    it('should default to pending for unknown order status', async () => {
      const order = createOrder();
      order.status = 'unknown_status';
      const request: OrderSyncRequest = {
        order,
        sourceConnectionId: 'source-connection-123',
      };

      processorAdapter.createOrder.mockResolvedValue({ orderId: 'dest_order_789' });

      await service.syncOrder(request);

      expect(processorAdapter.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'pending',
        }),
      );
    });

    it('should throw error if destination connection ID not configured', async () => {
      delete process.env.ORDER_SYNC_DESTINATION_CONNECTION_ID;
      const serviceWithoutConfig = new OrderSyncService(integrationsService, mappingConfigService);

      const order = createOrder();
      const request: OrderSyncRequest = {
        order,
        sourceConnectionId: 'source-connection-123',
      };

      await expect(serviceWithoutConfig.syncOrder(request)).rejects.toThrow(
        'ORDER_SYNC_DESTINATION_CONNECTION_ID not configured',
      );
    });

    it('should throw error if adapter resolution fails', async () => {
      const order = createOrder();
      const request: OrderSyncRequest = {
        order,
        sourceConnectionId: 'source-connection-123',
      };

      integrationsService.getCapabilityAdapter.mockRejectedValue(
        new Error('Connection not found'),
      );

      await expect(service.syncOrder(request)).rejects.toThrow('Connection not found');
    });

    it('should throw error if order creation fails', async () => {
      const order = createOrder();
      const request: OrderSyncRequest = {
        order,
        sourceConnectionId: 'source-connection-123',
      };

      processorAdapter.createOrder.mockRejectedValue(new Error('Order creation failed'));

      await expect(service.syncOrder(request)).rejects.toThrow('Order creation failed');
    });

    // ── MappingConfigService integration ──────────────────────────────────

    it('should use resolved status from mapping config when a mapping exists', async () => {
      const order = createOrder();
      order.status = 'READY_FOR_PROCESSING';
      const request: OrderSyncRequest = {
        order,
        sourceConnectionId: 'source-connection-123',
      };

      // Mapping resolves Allegro status to PS status ID '3' (Processing in progress)
      mappingConfigService.resolveStatusMapping.mockResolvedValue('processing');
      processorAdapter.createOrder.mockResolvedValue({ orderId: 'dest_order_789' });

      await service.syncOrder(request);

      expect(mappingConfigService.resolveStatusMapping).toHaveBeenCalledWith(
        'source-connection-123',
        'READY_FOR_PROCESSING',
      );
      expect(processorAdapter.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'processing' }),
      );
    });

    it('should fall back to order status when no mapping is configured', async () => {
      const order = createOrder();
      order.status = 'shipped';
      const request: OrderSyncRequest = {
        order,
        sourceConnectionId: 'source-connection-123',
      };

      mappingConfigService.resolveStatusMapping.mockResolvedValue(null);
      processorAdapter.createOrder.mockResolvedValue({ orderId: 'dest_order_789' });

      await service.syncOrder(request);

      expect(processorAdapter.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'shipped' }),
      );
    });

    it('should propagate error if mapping config service throws', async () => {
      const order = createOrder();
      const request: OrderSyncRequest = {
        order,
        sourceConnectionId: 'source-connection-123',
      };

      mappingConfigService.resolveStatusMapping.mockRejectedValue(
        new Error('Mapping service unavailable'),
      );

      await expect(service.syncOrder(request)).rejects.toThrow('Mapping service unavailable');
      expect(processorAdapter.createOrder).not.toHaveBeenCalled();
    });
  });
});


