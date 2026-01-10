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

describe('OrderSyncService', () => {
  let service: OrderSyncService;
  let integrationsService: jest.Mocked<IIntegrationsService>;
  let processorAdapter: jest.Mocked<OrderProcessorManagerPort>;

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

    // Set environment variable
    process.env.ORDER_SYNC_DESTINATION_CONNECTION_ID = destinationConnectionId;

    service = new OrderSyncService(integrationsService);
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
      const serviceWithoutConfig = new OrderSyncService(integrationsService);

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
  });
});


