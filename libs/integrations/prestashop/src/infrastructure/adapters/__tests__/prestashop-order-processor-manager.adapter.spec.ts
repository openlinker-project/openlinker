/**
 * PrestaShop Order Processor Manager Adapter Tests
 *
 * Unit tests for PrestashopOrderProcessorManagerAdapter. Tests order creation,
 * customer/product/variant ID resolution, order mapping, identifier mapping creation,
 * and error handling.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters/__tests__
 */
import { PrestashopOrderProcessorManagerAdapter } from '../prestashop-order-processor-manager.adapter';
import { createMockHttpClient } from '../../../__tests__/mocks/mock-http-client.factory';
import { createMockIdentifierMapping } from '../../../__tests__/mocks/mock-identifier-mapping.factory';
import { createTestConnection } from '../../../__tests__/fixtures/connection.fixture';
import { PrestashopApiException } from '@openlinker/integrations-prestashop';
import { IPrestashopWebserviceClient } from '../../http/prestashop-webservice.client.interface';
import { IPrestashopOrderMapper, PrestashopOrder } from '../../mappers/prestashop.mapper.interface';
import { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { OrderCreate } from '@openlinker/core/orders';

describe('PrestashopOrderProcessorManagerAdapter', () => {
  let adapter: PrestashopOrderProcessorManagerAdapter;
  let mockHttpClient: jest.Mocked<IPrestashopWebserviceClient>;
  let mockIdentifierMapping: jest.Mocked<IdentifierMappingPort>;
  let mockOrderMapper: jest.Mocked<IPrestashopOrderMapper>;
  let connection: ReturnType<typeof createTestConnection>;

  const createTestOrder = (overrides: Partial<OrderCreate> = {}): OrderCreate => ({
    orderNumber: 'TEST-ORDER-001',
    status: 'pending',
    customerId: 'internal-customer-123',
    items: [
      {
        id: 'item-1',
        productId: 'internal-product-456',
        variantId: 'internal-variant-789',
        quantity: 2,
        price: 29.99,
        sku: 'PROD-001-VAR-001',
      },
      {
        id: 'item-2',
        productId: 'internal-product-789',
        quantity: 1,
        price: 49.99,
        sku: 'PROD-002',
      },
    ],
    totals: {
      subtotal: 109.97,
      tax: 10.0,
      shipping: 5.0,
      total: 124.97,
      currency: 'EUR',
    },
    ...overrides,
  });

  beforeEach(() => {
    mockHttpClient = createMockHttpClient();
    mockIdentifierMapping = createMockIdentifierMapping();
    connection = createTestConnection();
    mockOrderMapper = {
      mapOrder: jest.fn(),
      mapOrderCreate: jest.fn(),
    } as unknown as jest.Mocked<IPrestashopOrderMapper>;

    adapter = new PrestashopOrderProcessorManagerAdapter(
      mockHttpClient,
      mockIdentifierMapping,
      mockOrderMapper,
      connection,
    );
  });

  describe('createOrder', () => {
    it('should create order successfully with all IDs resolved', async () => {
      const order = createTestOrder();
      const externalCustomerId = '42';
      const externalProductId1 = '100';
      const externalProductId2 = '200';
      const externalVariantId = '300';

      // Mock customer ID resolution
      mockIdentifierMapping.getExternalIds = jest.fn().mockImplementation((entityType, internalId) => {
        if (entityType === 'Customer' && internalId === 'internal-customer-123') {
          return Promise.resolve([
            {
              connectionId: connection.id,
              externalId: externalCustomerId,
              entityType: 'Customer',
            },
          ]);
        }
        if (entityType === 'Product' && internalId === 'internal-product-456') {
          return Promise.resolve([
            {
              connectionId: connection.id,
              externalId: externalProductId1,
              entityType: 'Product',
            },
          ]);
        }
        if (entityType === 'Product' && internalId === 'internal-product-789') {
          return Promise.resolve([
            {
              connectionId: connection.id,
              externalId: externalProductId2,
              entityType: 'Product',
            },
          ]);
        }
        if (entityType === 'Product' && internalId === 'internal-variant-789') {
          return Promise.resolve([
            {
              connectionId: connection.id,
              externalId: externalVariantId,
              entityType: 'Product',
            },
          ]);
        }
        return Promise.resolve([]);
      });

      // Mock order mapping
      const prestashopOrderData = {
        id_customer: externalCustomerId,
        current_state: 1,
        reference: order.orderNumber,
        associations: {
          order_rows: {
            order_row: [],
          },
        },
      };
      mockOrderMapper.mapOrderCreate.mockReturnValue(prestashopOrderData);

      // Mock order creation
      const createdOrder: PrestashopOrder = {
        id: '999',
        reference: order.orderNumber,
      };
      mockHttpClient.createResource = jest.fn().mockResolvedValue(createdOrder);

      // Mock identifier mapping creation
      const internalOrderId = 'internal-order-999';
      mockIdentifierMapping.getOrCreateInternalId = jest.fn().mockResolvedValue(internalOrderId);

      const result = await adapter.createOrder(order);

      expect(mockIdentifierMapping.getExternalIds).toHaveBeenCalledWith('Customer', 'internal-customer-123');
      expect(mockIdentifierMapping.getExternalIds).toHaveBeenCalledWith('Product', 'internal-product-456');
      expect(mockIdentifierMapping.getExternalIds).toHaveBeenCalledWith('Product', 'internal-product-789');
      expect(mockIdentifierMapping.getExternalIds).toHaveBeenCalledWith('Product', 'internal-variant-789');
      expect(mockOrderMapper.mapOrderCreate).toHaveBeenCalledWith(
        order,
        externalCustomerId,
        expect.any(Map),
        expect.any(Map),
      );
      expect(mockHttpClient.createResource).toHaveBeenCalledWith('orders', prestashopOrderData);
      expect(mockIdentifierMapping.getOrCreateInternalId).toHaveBeenCalledWith(
        'Order',
        '999',
        connection.id,
        expect.objectContaining({
          metadata: expect.objectContaining({
            orderNumber: order.orderNumber,
          }),
        }),
      );
      expect(result).toEqual({
        orderId: internalOrderId,
        orderNumber: order.orderNumber,
      });
    });

    it('should throw error when customer ID is missing', async () => {
      const order = createTestOrder({ customerId: undefined });

      await expect(adapter.createOrder(order)).rejects.toThrow(PrestashopApiException);
      await expect(adapter.createOrder(order)).rejects.toThrow('Customer ID is required');
    });

    it('should throw error when customer ID not found in PrestaShop', async () => {
      const order = createTestOrder();
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([]);

      await expect(adapter.createOrder(order)).rejects.toThrow(PrestashopApiException);
      await expect(adapter.createOrder(order)).rejects.toThrow('Customer not found in PrestaShop');
    });

    it('should throw error when customer ID found for different connection', async () => {
      const order = createTestOrder();
      mockIdentifierMapping.getExternalIds = jest.fn().mockResolvedValue([
        {
          connectionId: 'other-connection-id',
          externalId: '42',
          entityType: 'Customer',
        },
      ]);

      await expect(adapter.createOrder(order)).rejects.toThrow(PrestashopApiException);
      await expect(adapter.createOrder(order)).rejects.toThrow('Customer not found in PrestaShop');
    });

    it('should throw error when product ID not found in PrestaShop', async () => {
      const order = createTestOrder();
      mockIdentifierMapping.getExternalIds = jest.fn().mockImplementation((entityType, internalId) => {
        if (entityType === 'Customer' && internalId === 'internal-customer-123') {
          return Promise.resolve([
            {
              connectionId: connection.id,
              externalId: '42',
              entityType: 'Customer',
            },
          ]);
        }
        if (entityType === 'Product' && internalId === 'internal-product-456') {
          return Promise.resolve([]); // Product not found
        }
        return Promise.resolve([]);
      });

      await expect(adapter.createOrder(order)).rejects.toThrow(PrestashopApiException);
      await expect(adapter.createOrder(order)).rejects.toThrow('Product not found in PrestaShop');
    });

    it('should handle variant ID not found gracefully (uses 0 for no variant)', async () => {
      const order = createTestOrder();
      const externalCustomerId = '42';
      const externalProductId1 = '100';
      const externalProductId2 = '200';

      mockIdentifierMapping.getExternalIds = jest.fn().mockImplementation((entityType, internalId) => {
        if (entityType === 'Customer' && internalId === 'internal-customer-123') {
          return Promise.resolve([
            {
              connectionId: connection.id,
              externalId: externalCustomerId,
              entityType: 'Customer',
            },
          ]);
        }
        if (entityType === 'Product' && internalId === 'internal-product-456') {
          return Promise.resolve([
            {
              connectionId: connection.id,
              externalId: externalProductId1,
              entityType: 'Product',
            },
          ]);
        }
        if (entityType === 'Product' && internalId === 'internal-product-789') {
          return Promise.resolve([
            {
              connectionId: connection.id,
              externalId: externalProductId2,
              entityType: 'Product',
            },
          ]);
        }
        if (entityType === 'Product' && internalId === 'internal-variant-789') {
          return Promise.resolve([]); // Variant not found - should use 0
        }
        return Promise.resolve([]);
      });

      const prestashopOrderData = {
        id_customer: externalCustomerId,
        current_state: 1,
        associations: {
          order_rows: {
            order_row: [],
          },
        },
      };
      mockOrderMapper.mapOrderCreate.mockReturnValue(prestashopOrderData);

      const createdOrder: PrestashopOrder = {
        id: '999',
        reference: order.orderNumber,
      };
      mockHttpClient.createResource = jest.fn().mockResolvedValue(createdOrder);
      mockIdentifierMapping.getOrCreateInternalId = jest.fn().mockResolvedValue('internal-order-999');

      const result = await adapter.createOrder(order);

      // Should still succeed - variant mapping not found means use 0 (no variant)
      expect(result).toBeDefined();
      expect(mockHttpClient.createResource).toHaveBeenCalled();
    });

    it('should handle order creation API error', async () => {
      const order = createTestOrder();
      const externalCustomerId = '42';
      const externalProductId1 = '100';
      const externalProductId2 = '200';
      const externalVariantId = '300';

      mockIdentifierMapping.getExternalIds = jest.fn().mockImplementation((entityType, internalId) => {
        if (entityType === 'Customer' && internalId === 'internal-customer-123') {
          return Promise.resolve([
            {
              connectionId: connection.id,
              externalId: externalCustomerId,
              entityType: 'Customer',
            },
          ]);
        }
        if (entityType === 'Product' && internalId === 'internal-product-456') {
          return Promise.resolve([
            {
              connectionId: connection.id,
              externalId: externalProductId1,
              entityType: 'Product',
            },
          ]);
        }
        if (entityType === 'Product' && internalId === 'internal-product-789') {
          return Promise.resolve([
            {
              connectionId: connection.id,
              externalId: externalProductId2,
              entityType: 'Product',
            },
          ]);
        }
        if (entityType === 'Product' && internalId === 'internal-variant-789') {
          return Promise.resolve([
            {
              connectionId: connection.id,
              externalId: externalVariantId,
              entityType: 'Product',
            },
          ]);
        }
        return Promise.resolve([]);
      });

      const prestashopOrderData = {
        id_customer: externalCustomerId,
        current_state: 1,
        associations: {
          order_rows: {
            order_row: [],
          },
        },
      };
      mockOrderMapper.mapOrderCreate.mockReturnValue(prestashopOrderData);

      const apiError = new PrestashopApiException('Order creation failed', 400, 'Invalid order data');
      mockHttpClient.createResource = jest.fn().mockRejectedValue(apiError);

      await expect(adapter.createOrder(order)).rejects.toThrow(PrestashopApiException);
      await expect(adapter.createOrder(order)).rejects.toThrow('Order creation failed');
    });

    it('should create identifier mapping for new order', async () => {
      const order = createTestOrder();
      const externalCustomerId = '42';
      const externalProductId1 = '100';
      const externalProductId2 = '200';
      const externalVariantId = '300';

      mockIdentifierMapping.getExternalIds = jest.fn().mockImplementation((entityType, internalId) => {
        if (entityType === 'Customer' && internalId === 'internal-customer-123') {
          return Promise.resolve([
            {
              connectionId: connection.id,
              externalId: externalCustomerId,
              entityType: 'Customer',
            },
          ]);
        }
        if (entityType === 'Product' && internalId === 'internal-product-456') {
          return Promise.resolve([
            {
              connectionId: connection.id,
              externalId: externalProductId1,
              entityType: 'Product',
            },
          ]);
        }
        if (entityType === 'Product' && internalId === 'internal-product-789') {
          return Promise.resolve([
            {
              connectionId: connection.id,
              externalId: externalProductId2,
              entityType: 'Product',
            },
          ]);
        }
        if (entityType === 'Product' && internalId === 'internal-variant-789') {
          return Promise.resolve([
            {
              connectionId: connection.id,
              externalId: externalVariantId,
              entityType: 'Product',
            },
          ]);
        }
        return Promise.resolve([]);
      });

      const prestashopOrderData = {
        id_customer: externalCustomerId,
        current_state: 1,
        associations: {
          order_rows: {
            order_row: [],
          },
        },
      };
      mockOrderMapper.mapOrderCreate.mockReturnValue(prestashopOrderData);

      const createdOrder: PrestashopOrder = {
        id: '999',
        reference: 'PS-ORDER-999',
      };
      mockHttpClient.createResource = jest.fn().mockResolvedValue(createdOrder);

      const internalOrderId = 'internal-order-999';
      mockIdentifierMapping.getOrCreateInternalId = jest.fn().mockResolvedValue(internalOrderId);

      await adapter.createOrder(order);

      expect(mockIdentifierMapping.getOrCreateInternalId).toHaveBeenCalledWith(
        'Order',
        '999',
        connection.id,
        expect.objectContaining({
          metadata: expect.objectContaining({
            orderNumber: order.orderNumber,
            createdAt: expect.any(String),
          }),
        }),
      );
    });

    it('should use created order reference if order number not provided', async () => {
      const order = createTestOrder({ orderNumber: undefined });
      const externalCustomerId = '42';
      const externalProductId1 = '100';
      const externalProductId2 = '200';
      const externalVariantId = '300';

      mockIdentifierMapping.getExternalIds = jest.fn().mockImplementation((entityType, internalId) => {
        if (entityType === 'Customer' && internalId === 'internal-customer-123') {
          return Promise.resolve([
            {
              connectionId: connection.id,
              externalId: externalCustomerId,
              entityType: 'Customer',
            },
          ]);
        }
        if (entityType === 'Product' && internalId === 'internal-product-456') {
          return Promise.resolve([
            {
              connectionId: connection.id,
              externalId: externalProductId1,
              entityType: 'Product',
            },
          ]);
        }
        if (entityType === 'Product' && internalId === 'internal-product-789') {
          return Promise.resolve([
            {
              connectionId: connection.id,
              externalId: externalProductId2,
              entityType: 'Product',
            },
          ]);
        }
        if (entityType === 'Product' && internalId === 'internal-variant-789') {
          return Promise.resolve([
            {
              connectionId: connection.id,
              externalId: externalVariantId,
              entityType: 'Product',
            },
          ]);
        }
        return Promise.resolve([]);
      });

      const prestashopOrderData = {
        id_customer: externalCustomerId,
        current_state: 1,
        associations: {
          order_rows: {
            order_row: [],
          },
        },
      };
      mockOrderMapper.mapOrderCreate.mockReturnValue(prestashopOrderData);

      const createdOrder: PrestashopOrder = {
        id: '999',
        reference: 'PS-ORDER-999',
      };
      mockHttpClient.createResource = jest.fn().mockResolvedValue(createdOrder);
      mockIdentifierMapping.getOrCreateInternalId = jest.fn().mockResolvedValue('internal-order-999');

      const result = await adapter.createOrder(order);

      expect(result.orderNumber).toBe('PS-ORDER-999');
      expect(mockIdentifierMapping.getOrCreateInternalId).toHaveBeenCalledWith(
        'Order',
        '999',
        connection.id,
        expect.objectContaining({
          metadata: expect.objectContaining({
            orderNumber: 'PS-ORDER-999',
          }),
        }),
      );
    });

    it('should handle generic errors and wrap in PrestashopApiException', async () => {
      const order = createTestOrder();
      const externalCustomerId = '42';

      mockIdentifierMapping.getExternalIds = jest.fn().mockImplementation((entityType, internalId) => {
        if (entityType === 'Customer' && internalId === 'internal-customer-123') {
          return Promise.resolve([
            {
              connectionId: connection.id,
              externalId: externalCustomerId,
              entityType: 'Customer',
            },
          ]);
        }
        // Simulate error during product ID resolution
        throw new Error('Database connection failed');
      });

      await expect(adapter.createOrder(order)).rejects.toThrow(PrestashopApiException);
      await expect(adapter.createOrder(order)).rejects.toThrow('Failed to create PrestaShop order');
    });
  });
});

