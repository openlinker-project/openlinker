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
import {
  IdentifierMappingPort,
  DuplicateIdentifierMappingError,
} from '@openlinker/core/identifier-mapping';
import { OrderCreate } from '@openlinker/core/orders';
import { IMappingConfigService } from '@openlinker/core/mappings';
import { PrestashopCurrencyResolver } from '../../provisioners/prestashop-currency-resolver';
import { CustomerProjectionRepositoryPort } from '@openlinker/core/customers';
import { PrestashopCustomerProvisioner } from '../../provisioners/prestashop-customer-provisioner';
import { PrestashopAddressProvisioner } from '../../provisioners/prestashop-address-provisioner';

describe('PrestashopOrderProcessorManagerAdapter', () => {
  let adapter: PrestashopOrderProcessorManagerAdapter;
  let mockHttpClient: jest.Mocked<IPrestashopWebserviceClient>;
  let mockIdentifierMapping: jest.Mocked<IdentifierMappingPort>;
  let mockOrderMapper: jest.Mocked<IPrestashopOrderMapper>;
  let mockCurrencyResolver: jest.Mocked<PrestashopCurrencyResolver>;
  let mockCustomerProjectionRepository: jest.Mocked<CustomerProjectionRepositoryPort>;
  let mockCustomerProvisioner: jest.Mocked<PrestashopCustomerProvisioner>;
  let mockAddressProvisioner: jest.Mocked<PrestashopAddressProvisioner>;
  let connection: ReturnType<typeof createTestConnection>;

  const METADATA_INTERNAL_ORDER_ID = 'ol_order_allegro_abc123';

  const createTestOrder = (overrides: Partial<OrderCreate> = {}): OrderCreate => ({
    orderNumber: 'TEST-ORDER-001',
    status: 'pending',
    customerId: 'internal-customer-123',
    metadata: { internalOrderId: METADATA_INTERNAL_ORDER_ID },
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
      mapCartCreate: jest.fn().mockReturnValue({
        id_customer: '42',
        id_currency: 1,
        id_lang: 1,
        associations: {
          cart_rows: {
            cart_row: [],
          },
        },
      }),
    } as unknown as jest.Mocked<IPrestashopOrderMapper>;

    mockCurrencyResolver = {
      resolveCurrencyId: jest.fn().mockResolvedValue(1), // Default to ID 1
      clearCache: jest.fn(),
    } as unknown as jest.Mocked<PrestashopCurrencyResolver>;

    mockCustomerProjectionRepository = {
      findById: jest.fn(),
      findByEmailHash: jest.fn(),
      upsertProjection: jest.fn(),
    } as unknown as jest.Mocked<CustomerProjectionRepositoryPort>;

    mockCustomerProvisioner = {
      resolveOrCreateGuestCustomer: jest.fn(),
    } as unknown as jest.Mocked<PrestashopCustomerProvisioner>;

    mockAddressProvisioner = {
      resolveOrCreateAddress: jest.fn(),
    } as unknown as jest.Mocked<PrestashopAddressProvisioner>;

    adapter = new PrestashopOrderProcessorManagerAdapter(
      mockHttpClient,
      mockIdentifierMapping,
      mockOrderMapper,
      connection,
      mockCustomerProvisioner,
      mockAddressProvisioner,
      mockCurrencyResolver,
      mockCustomerProjectionRepository,
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
        if (entityType === 'ProductVariant' && internalId === 'internal-variant-789') {
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

      // Mock cart and order creation
      const createdCart = { id: '123' };
      const createdOrder: PrestashopOrder = {
        id: '999',
        reference: order.orderNumber,
      };
      mockHttpClient.createResource = jest
        .fn()
        .mockResolvedValueOnce(createdCart) // First call: cart creation
        .mockResolvedValueOnce(createdOrder); // Second call: order creation

      // Mock identifier mapping creation
      mockIdentifierMapping.createMapping = jest.fn().mockResolvedValue(undefined);

      const result = await adapter.createOrder(order);

      expect(mockIdentifierMapping.getExternalIds).toHaveBeenCalledWith('Customer', 'internal-customer-123');
      expect(mockIdentifierMapping.getExternalIds).toHaveBeenCalledWith('Product', 'internal-product-456');
      expect(mockIdentifierMapping.getExternalIds).toHaveBeenCalledWith('Product', 'internal-product-789');
      expect(mockIdentifierMapping.getExternalIds).toHaveBeenCalledWith('ProductVariant', 'internal-variant-789');
      expect(mockOrderMapper.mapCartCreate).toHaveBeenCalled();
      expect(mockOrderMapper.mapOrderCreate).toHaveBeenCalledWith(
        order,
        externalCustomerId,
        expect.any(Map),
        expect.any(Map),
        undefined,
        undefined,
        1, // currencyId
        1, // langId
        undefined, // externalCarrierId — no mapping configured, no defaultCarrierId; mapper falls back to 1
      );
      expect(mockHttpClient.createResource).toHaveBeenCalledWith('carts', expect.any(Object));
      expect(mockHttpClient.createResource).toHaveBeenCalledWith('orders', prestashopOrderData);
      expect(mockIdentifierMapping.createMapping).toHaveBeenCalledWith(
        'Order',
        '999',
        connection.id,
        METADATA_INTERNAL_ORDER_ID,
        expect.objectContaining({
          metadata: expect.objectContaining({
            orderNumber: order.orderNumber,
          }),
        }),
      );
      expect(result).toEqual({
        orderId: METADATA_INTERNAL_ORDER_ID,
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
      // When no external ID is found, code tries to provision customer, but projection is missing
      mockCustomerProjectionRepository.findById = jest.fn().mockResolvedValue(null);

      await expect(adapter.createOrder(order)).rejects.toThrow(PrestashopApiException);
      await expect(adapter.createOrder(order)).rejects.toThrow(
        'Cannot provision customer: customer projection not found or email missing',
      );
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
      // When no external ID is found for this connection, code tries to provision customer, but projection is missing
      mockCustomerProjectionRepository.findById = jest.fn().mockResolvedValue(null);

      await expect(adapter.createOrder(order)).rejects.toThrow(PrestashopApiException);
      await expect(adapter.createOrder(order)).rejects.toThrow(
        'Cannot provision customer: customer projection not found or email missing',
      );
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
        if (entityType === 'ProductVariant' && internalId === 'internal-variant-789') {
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
      mockIdentifierMapping.createMapping = jest.fn().mockResolvedValue(undefined);

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
        if (entityType === 'ProductVariant' && internalId === 'internal-variant-789') {
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

      // Mock cart creation to succeed
      const createdCart = { id: '123' };
      // Mock order creation to fail
      const apiError = new PrestashopApiException('Order creation failed', 400, 'Invalid order data');
      mockHttpClient.createResource = jest.fn().mockImplementation((resource: string) => {
        if (resource === 'carts') {
          return Promise.resolve(createdCart);
        }
        if (resource === 'orders') {
          return Promise.reject(apiError);
        }
        return Promise.reject(new Error(`Unexpected resource: ${resource}`));
      });

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
        if (entityType === 'ProductVariant' && internalId === 'internal-variant-789') {
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

      mockIdentifierMapping.createMapping = jest.fn().mockResolvedValue(undefined);

      await adapter.createOrder(order);

      expect(mockIdentifierMapping.createMapping).toHaveBeenCalledWith(
        'Order',
        '999',
        connection.id,
        METADATA_INTERNAL_ORDER_ID,
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
        if (entityType === 'ProductVariant' && internalId === 'internal-variant-789') {
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
      mockIdentifierMapping.createMapping = jest.fn().mockResolvedValue(undefined);

      const result = await adapter.createOrder(order);

      expect(result.orderNumber).toBe('PS-ORDER-999');
      expect(mockIdentifierMapping.createMapping).toHaveBeenCalledWith(
        'Order',
        '999',
        connection.id,
        METADATA_INTERNAL_ORDER_ID,
        expect.objectContaining({
          metadata: expect.objectContaining({
            orderNumber: 'PS-ORDER-999',
          }),
        }),
      );
    });

    it('should be idempotent: second call with same metadata.internalOrderId early-returns without PS create', async () => {
      const order = createTestOrder();
      const externalCustomerId = '42';
      const externalProductId1 = '100';
      const externalProductId2 = '200';
      const externalVariantId = '300';
      const externalPsOrderId = '999';

      const resolveExternalIds = (entityType: string, internalId: string) => {
        if (entityType === 'Order' && internalId === METADATA_INTERNAL_ORDER_ID) {
          return Promise.resolve([
            { connectionId: connection.id, externalId: externalPsOrderId, entityType: 'Order' },
          ]);
        }
        if (entityType === 'Customer' && internalId === 'internal-customer-123') {
          return Promise.resolve([
            { connectionId: connection.id, externalId: externalCustomerId, entityType: 'Customer' },
          ]);
        }
        if (entityType === 'Product' && internalId === 'internal-product-456') {
          return Promise.resolve([
            { connectionId: connection.id, externalId: externalProductId1, entityType: 'Product' },
          ]);
        }
        if (entityType === 'Product' && internalId === 'internal-product-789') {
          return Promise.resolve([
            { connectionId: connection.id, externalId: externalProductId2, entityType: 'Product' },
          ]);
        }
        if (entityType === 'ProductVariant' && internalId === 'internal-variant-789') {
          return Promise.resolve([
            { connectionId: connection.id, externalId: externalVariantId, entityType: 'ProductVariant' },
          ]);
        }
        return Promise.resolve([]);
      };

      // First call: Step 0 returns nothing (no existing mapping), PS create succeeds.
      mockIdentifierMapping.getExternalIds = jest
        .fn()
        .mockImplementation((entityType: string, internalId: string) => {
          if (entityType === 'Order') return Promise.resolve([]);
          return resolveExternalIds(entityType, internalId);
        });

      const prestashopOrderData = { id_customer: externalCustomerId, current_state: 1, associations: { order_rows: { order_row: [] } } };
      mockOrderMapper.mapOrderCreate.mockReturnValue(prestashopOrderData);

      const createdCart = { id: '123' };
      const createdOrder: PrestashopOrder = { id: externalPsOrderId, reference: order.orderNumber };
      mockHttpClient.createResource = jest
        .fn()
        .mockResolvedValueOnce(createdCart)
        .mockResolvedValueOnce(createdOrder);
      mockIdentifierMapping.createMapping = jest.fn().mockResolvedValue(undefined);

      await adapter.createOrder(order);
      expect(mockHttpClient.createResource).toHaveBeenCalledTimes(2); // cart + order

      // Second call: Step 0 finds the mapping → early-return.
      mockIdentifierMapping.getExternalIds = jest.fn().mockImplementation(resolveExternalIds);
      mockHttpClient.createResource = jest.fn();

      const result = await adapter.createOrder(order);

      expect(mockHttpClient.createResource).not.toHaveBeenCalled();
      expect(result).toEqual({
        orderId: METADATA_INTERNAL_ORDER_ID,
        orderNumber: expect.any(String),
      });
    });

    it('should treat DuplicateIdentifierMappingError from createMapping as idempotent success (concurrent race)', async () => {
      const order = createTestOrder();
      const externalCustomerId = '42';
      const externalProductId1 = '100';
      const externalProductId2 = '200';
      const externalVariantId = '300';

      mockIdentifierMapping.getExternalIds = jest.fn().mockImplementation((entityType: string, internalId: string) => {
        if (entityType === 'Order') return Promise.resolve([]);
        if (entityType === 'Customer' && internalId === 'internal-customer-123')
          return Promise.resolve([{ connectionId: connection.id, externalId: externalCustomerId, entityType: 'Customer' }]);
        if (entityType === 'Product' && internalId === 'internal-product-456')
          return Promise.resolve([{ connectionId: connection.id, externalId: externalProductId1, entityType: 'Product' }]);
        if (entityType === 'Product' && internalId === 'internal-product-789')
          return Promise.resolve([{ connectionId: connection.id, externalId: externalProductId2, entityType: 'Product' }]);
        if (entityType === 'ProductVariant' && internalId === 'internal-variant-789')
          return Promise.resolve([{ connectionId: connection.id, externalId: externalVariantId, entityType: 'ProductVariant' }]);
        return Promise.resolve([]);
      });

      const prestashopOrderData = { id_customer: externalCustomerId, current_state: 1, associations: { order_rows: { order_row: [] } } };
      mockOrderMapper.mapOrderCreate.mockReturnValue(prestashopOrderData);

      const createdCart = { id: '123' };
      const createdOrder: PrestashopOrder = { id: '999', reference: order.orderNumber };
      mockHttpClient.createResource = jest
        .fn()
        .mockResolvedValueOnce(createdCart)
        .mockResolvedValueOnce(createdOrder);

      // Simulate concurrent-insert race: createMapping throws DuplicateIdentifierMappingError
      mockIdentifierMapping.createMapping = jest.fn().mockRejectedValue(
        new DuplicateIdentifierMappingError('Order', '999', 'prestashop', connection.id),
      );

      const result = await adapter.createOrder(order);

      // Adapter must treat the race as idempotent success
      expect(result).toEqual({
        orderId: METADATA_INTERNAL_ORDER_ID,
        orderNumber: order.orderNumber,
      });
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

  describe('carrier resolution (#455)', () => {
    const ALLEGRO_CONNECTION_ID = 'conn-allegro-1';
    const ALLEGRO_METHOD_ID = '1fa56f79-aaa';

    const buildOrderWithShipping = (): OrderCreate => ({
      ...createTestOrder(),
      shipping: { methodId: ALLEGRO_METHOD_ID, methodName: 'InPost Paczkomat' },
      source: { connectionId: ALLEGRO_CONNECTION_ID },
    });

    const wireSuccessfulMappings = (externalCustomerId: string): void => {
      mockIdentifierMapping.getExternalIds = jest.fn().mockImplementation((entityType, internalId) => {
        if (entityType === 'Customer') {
          return Promise.resolve([
            { connectionId: connection.id, externalId: externalCustomerId, entityType: 'Customer' },
          ]);
        }
        if (entityType === 'Product' && internalId === 'internal-product-456') {
          return Promise.resolve([
            { connectionId: connection.id, externalId: '100', entityType: 'Product' },
          ]);
        }
        if (entityType === 'Product' && internalId === 'internal-product-789') {
          return Promise.resolve([
            { connectionId: connection.id, externalId: '200', entityType: 'Product' },
          ]);
        }
        if (entityType === 'ProductVariant') {
          return Promise.resolve([
            { connectionId: connection.id, externalId: '300', entityType: 'ProductVariant' },
          ]);
        }
        return Promise.resolve([]);
      });

      mockOrderMapper.mapOrderCreate.mockReturnValue({
        id_customer: externalCustomerId,
        current_state: 1,
        associations: { order_rows: { order_row: [] } },
      });

      mockHttpClient.createResource = jest
        .fn()
        .mockResolvedValueOnce({ id: '123' })
        .mockResolvedValueOnce({ id: '999', reference: 'TEST-ORDER-001' } as PrestashopOrder);

      mockIdentifierMapping.createMapping = jest.fn().mockResolvedValue(undefined);
    };

    it('passes mapped externalCarrierId to mapOrderCreate when MappingConfigService resolves', async () => {
      wireSuccessfulMappings('42');
      const resolveCarrierMapping = jest.fn().mockResolvedValue('4');
      const mockMappingConfig = { resolveCarrierMapping } as unknown as IMappingConfigService;
      const adapterWithMapping = new PrestashopOrderProcessorManagerAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        mockOrderMapper,
        connection,
        mockCustomerProvisioner,
        mockAddressProvisioner,
        mockCurrencyResolver,
        mockCustomerProjectionRepository,
        mockMappingConfig,
      );

      await adapterWithMapping.createOrder(buildOrderWithShipping());

      // 9th arg = externalCarrierId
      expect(mockOrderMapper.mapOrderCreate).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.any(Map),
        expect.any(Map),
        undefined,
        undefined,
        1,
        1,
        4,
      );
      expect(resolveCarrierMapping).toHaveBeenCalledWith(ALLEGRO_CONNECTION_ID, ALLEGRO_METHOD_ID);
    });

    it('falls back to connection.config.defaultCarrierId when no mapping resolves', async () => {
      wireSuccessfulMappings('42');
      // Connection fixture with defaultCarrierId set.
      const connWithDefault = createTestConnection();
      (connWithDefault.config as Record<string, unknown>).defaultCarrierId = 7;

      const mockMappingConfig = {
        resolveCarrierMapping: jest.fn().mockResolvedValue(null),
      } as unknown as IMappingConfigService;
      const adapterWithMapping = new PrestashopOrderProcessorManagerAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        mockOrderMapper,
        connWithDefault,
        mockCustomerProvisioner,
        mockAddressProvisioner,
        mockCurrencyResolver,
        mockCustomerProjectionRepository,
        mockMappingConfig,
      );

      await adapterWithMapping.createOrder(buildOrderWithShipping());

      expect(mockOrderMapper.mapOrderCreate).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.any(Map),
        expect.any(Map),
        undefined,
        undefined,
        1,
        1,
        7,
      );
    });

    it('passes undefined externalCarrierId when neither mapping nor defaultCarrierId is set (mapper falls back to 1)', async () => {
      wireSuccessfulMappings('42');
      const mockMappingConfig = {
        resolveCarrierMapping: jest.fn().mockResolvedValue(null),
      } as unknown as IMappingConfigService;
      const adapterWithMapping = new PrestashopOrderProcessorManagerAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        mockOrderMapper,
        connection, // default fixture — no defaultCarrierId
        mockCustomerProvisioner,
        mockAddressProvisioner,
        mockCurrencyResolver,
        mockCustomerProjectionRepository,
        mockMappingConfig,
      );

      await adapterWithMapping.createOrder(buildOrderWithShipping());

      expect(mockOrderMapper.mapOrderCreate).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.any(Map),
        expect.any(Map),
        undefined,
        undefined,
        1,
        1,
        undefined,
      );
    });
  });

  describe('shipping cost reconciliation (#467)', () => {
    const EXTERNAL_ORDER_ID = '999';
    const EXTERNAL_ORDER_CARRIER_ID = '5001';
    const EXTERNAL_ORDER_NUMBER = 'TEST-ORDER-001';

    const buildOrderWithShippingTotal = (shipping: number): OrderCreate => ({
      ...createTestOrder(),
      totals: {
        subtotal: 109.97,
        tax: 10.0,
        shipping,
        total: 109.97 + 10.0 + shipping,
        currency: 'EUR',
      },
    });

    /**
     * Wire mocks for a happy-path first-time order create so the only
     * variable across these tests is the order_carriers reconcile path.
     */
    const wireFirstTimeCreatePath = (): void => {
      // Step 0: no existing destination mapping → falls through to create.
      // Steps 1-5: customer / product / variant resolutions all succeed.
      mockIdentifierMapping.getExternalIds = jest
        .fn()
        .mockImplementation((entityType: string) => {
          if (entityType === 'Customer') {
            return Promise.resolve([
              { connectionId: connection.id, externalId: '42', entityType: 'Customer' },
            ]);
          }
          if (entityType === 'Product') {
            return Promise.resolve([
              { connectionId: connection.id, externalId: '100', entityType: 'Product' },
            ]);
          }
          if (entityType === 'ProductVariant') {
            return Promise.resolve([
              { connectionId: connection.id, externalId: '300', entityType: 'ProductVariant' },
            ]);
          }
          // 'Order' lookup at Step 0 — return empty so we don't short-circuit.
          return Promise.resolve([]);
        });

      mockOrderMapper.mapOrderCreate.mockReturnValue({
        id_customer: '42',
        current_state: 1,
        associations: { order_rows: { order_row: [] } },
      });

      // createResource is called twice: cart, then order.
      mockHttpClient.createResource = jest
        .fn()
        .mockResolvedValueOnce({ id: '123' }) // cart
        .mockResolvedValueOnce({
          id: EXTERNAL_ORDER_ID,
          reference: EXTERNAL_ORDER_NUMBER,
        } as PrestashopOrder);

      mockIdentifierMapping.createMapping = jest.fn().mockResolvedValue(undefined);
    };

    it('should write shipping_cost_* via order_carriers PUT when totals.shipping > 0', async () => {
      wireFirstTimeCreatePath();
      mockHttpClient.listResources = jest
        .fn()
        .mockResolvedValueOnce([{ id: EXTERNAL_ORDER_CARRIER_ID, id_order: EXTERNAL_ORDER_ID, id_carrier: '1' }]);
      mockHttpClient.getResource = jest.fn().mockResolvedValueOnce({
        id: EXTERNAL_ORDER_CARRIER_ID,
        id_order: EXTERNAL_ORDER_ID,
        id_carrier: '1',
        weight: '0.000',
        shipping_cost_tax_excl: '0.000000',
        shipping_cost_tax_incl: '0.000000',
        tracking_number: '',
      });
      mockHttpClient.updateResource = jest.fn().mockResolvedValueOnce(undefined);

      await adapter.createOrder(buildOrderWithShippingTotal(10.95));

      expect(mockHttpClient.listResources).toHaveBeenCalledWith(
        'order_carriers',
        { custom: { id_order: EXTERNAL_ORDER_ID } },
        1,
        0,
      );
      expect(mockHttpClient.getResource).toHaveBeenCalledWith(
        'order_carriers',
        EXTERNAL_ORDER_CARRIER_ID,
      );
      expect(mockHttpClient.updateResource).toHaveBeenCalledWith(
        'order_carriers',
        EXTERNAL_ORDER_CARRIER_ID,
        expect.objectContaining({
          // Existing fields are spread through (full-resource PUT contract).
          id: EXTERNAL_ORDER_CARRIER_ID,
          id_order: EXTERNAL_ORDER_ID,
          id_carrier: '1',
          weight: '0.000',
          tracking_number: '',
          // Cost fields are overwritten with the order's shipping total.
          shipping_cost_tax_excl: '10.95',
          shipping_cost_tax_incl: '10.95',
        }),
      );
    });

    it('should skip the order_carriers round-trip when totals.shipping is zero', async () => {
      wireFirstTimeCreatePath();
      mockHttpClient.listResources = jest.fn();
      mockHttpClient.getResource = jest.fn();
      mockHttpClient.updateResource = jest.fn();

      const ref = await adapter.createOrder(buildOrderWithShippingTotal(0));

      expect(ref.orderId).toBe(METADATA_INTERNAL_ORDER_ID);
      expect(mockHttpClient.listResources).not.toHaveBeenCalled();
      expect(mockHttpClient.getResource).not.toHaveBeenCalled();
      expect(mockHttpClient.updateResource).not.toHaveBeenCalled();
    });

    it('should warn and skip the PUT when no order_carrier row is found', async () => {
      wireFirstTimeCreatePath();
      mockHttpClient.listResources = jest.fn().mockResolvedValueOnce([]);
      mockHttpClient.getResource = jest.fn();
      mockHttpClient.updateResource = jest.fn();

      const ref = await adapter.createOrder(buildOrderWithShippingTotal(10.95));

      expect(ref.orderId).toBe(METADATA_INTERNAL_ORDER_ID);
      expect(mockHttpClient.listResources).toHaveBeenCalledTimes(1);
      expect(mockHttpClient.getResource).not.toHaveBeenCalled();
      expect(mockHttpClient.updateResource).not.toHaveBeenCalled();
    });

    it('should swallow and log when the order_carriers update throws', async () => {
      wireFirstTimeCreatePath();
      mockHttpClient.listResources = jest
        .fn()
        .mockResolvedValueOnce([{ id: EXTERNAL_ORDER_CARRIER_ID, id_order: EXTERNAL_ORDER_ID, id_carrier: '1' }]);
      mockHttpClient.getResource = jest.fn().mockResolvedValueOnce({
        id: EXTERNAL_ORDER_CARRIER_ID,
        id_order: EXTERNAL_ORDER_ID,
        id_carrier: '1',
      });
      mockHttpClient.updateResource = jest
        .fn()
        .mockRejectedValueOnce(new PrestashopApiException('boom', 500, 'server error'));

      // The whole createOrder must still resolve and return the OrderRef —
      // the order is already created in PS, only the cost reconcile failed.
      const ref = await adapter.createOrder(buildOrderWithShippingTotal(10.95));

      expect(ref.orderId).toBe(METADATA_INTERNAL_ORDER_ID);
      expect(ref.orderNumber).toBe(EXTERNAL_ORDER_NUMBER);
      expect(mockHttpClient.updateResource).toHaveBeenCalledTimes(1);
    });

    it('should reconcile shipping cost on retry when the destination order mapping already exists', async () => {
      // Step 0 short-circuits: getExternalIds('Order', ...) returns an
      // existing PS order. The reconcile step must STILL run so that a
      // partial first run (mapping committed but reconcile crashed) can
      // self-heal on retry.
      mockIdentifierMapping.getExternalIds = jest
        .fn()
        .mockImplementation((entityType: string) => {
          if (entityType === 'Order') {
            return Promise.resolve([
              { connectionId: connection.id, externalId: EXTERNAL_ORDER_ID, entityType: 'Order' },
            ]);
          }
          return Promise.resolve([]);
        });

      mockHttpClient.listResources = jest
        .fn()
        .mockResolvedValueOnce([{ id: EXTERNAL_ORDER_CARRIER_ID, id_order: EXTERNAL_ORDER_ID, id_carrier: '1' }]);
      mockHttpClient.getResource = jest.fn().mockResolvedValueOnce({
        id: EXTERNAL_ORDER_CARRIER_ID,
        id_order: EXTERNAL_ORDER_ID,
        id_carrier: '1',
      });
      mockHttpClient.updateResource = jest.fn().mockResolvedValueOnce(undefined);

      const ref = await adapter.createOrder(buildOrderWithShippingTotal(10.95));

      expect(ref.orderId).toBe(METADATA_INTERNAL_ORDER_ID);
      // No order create was attempted — Step 0 returned early — but the
      // reconcile path was still exercised.
      expect(mockHttpClient.createResource).not.toHaveBeenCalled();
      expect(mockHttpClient.updateResource).toHaveBeenCalledWith(
        'order_carriers',
        EXTERNAL_ORDER_CARRIER_ID,
        expect.objectContaining({
          shipping_cost_tax_excl: '10.95',
          shipping_cost_tax_incl: '10.95',
        }),
      );
    });
  });

  describe('pickup-point forwarding (#458)', () => {
    it('forwards order.pickupPoint into addressProvisioner.resolveOrCreateAddress', async () => {
      const order: OrderCreate = {
        ...createTestOrder(),
        shippingAddress: {
          firstName: 'Buyer',
          lastName: 'Profile',
          address1: 'ul. Lockerowa 1',
          city: 'Poznań',
          postalCode: '60-001',
          country: 'PL',
        },
        pickupPoint: { id: 'POZ08A', name: 'Paczkomat POZ08A', description: 'Stacja paliw BP' },
      };

      mockIdentifierMapping.getExternalIds = jest.fn().mockImplementation((entityType) => {
        if (entityType === 'Customer') {
          return Promise.resolve([
            { connectionId: connection.id, externalId: '42', entityType: 'Customer' },
          ]);
        }
        if (entityType === 'Product') {
          return Promise.resolve([
            { connectionId: connection.id, externalId: '100', entityType: 'Product' },
          ]);
        }
        if (entityType === 'ProductVariant') {
          return Promise.resolve([
            { connectionId: connection.id, externalId: '300', entityType: 'ProductVariant' },
          ]);
        }
        return Promise.resolve([]);
      });
      mockAddressProvisioner.resolveOrCreateAddress = jest.fn().mockResolvedValue('800');

      mockOrderMapper.mapOrderCreate.mockReturnValue({
        id_customer: '42',
        current_state: 1,
        associations: { order_rows: { order_row: [] } },
      });
      mockHttpClient.createResource = jest
        .fn()
        .mockResolvedValueOnce({ id: '123' })
        .mockResolvedValueOnce({ id: '999', reference: 'TEST-ORDER-001' } as PrestashopOrder);
      mockIdentifierMapping.createMapping = jest.fn().mockResolvedValue(undefined);

      await adapter.createOrder(order);

      // 9th positional arg of resolveOrCreateAddress is `pickupPoint`.
      expect(mockAddressProvisioner.resolveOrCreateAddress).toHaveBeenCalledWith(
        expect.any(String), // internalCustomerId
        expect.any(String), // prestashopCustomerId
        order.shippingAddress,
        'shipping',
        connection.id,
        mockHttpClient,
        expect.any(Object), // connectionConfig
        mockCustomerProjectionRepository,
        order.pickupPoint,
      );
    });
  });

  describe('DestinationOptionsReader (#472 / #473)', () => {
    describe('listCarriers', () => {
      it('returns active non-deleted carriers with id_reference as value', async () => {
        mockHttpClient.listResources = jest.fn().mockResolvedValueOnce([
          { id: '1', id_reference: '1', name: 'Click and collect', active: '1', deleted: '0' },
          { id: '2', id_reference: '2', name: 'My carrier', active: '1', deleted: '0' },
          { id: '3', id_reference: '3', name: 'My cheap carrier', active: '1', deleted: '0' },
          { id: '4', id_reference: '4', name: 'My light carrier', active: '1', deleted: '0' },
        ]);

        const result = await adapter.listCarriers();

        expect(mockHttpClient.listResources).toHaveBeenCalledWith(
          'carriers',
          { custom: { active: '1', deleted: '0' } },
          1000,
          0,
        );
        expect(result).toEqual([
          { value: '1', label: 'Click and collect' },
          { value: '2', label: 'My carrier' },
          { value: '3', label: 'My cheap carrier' },
          { value: '4', label: 'My light carrier' },
        ]);
      });

      it('unwraps multi-language name field shape', async () => {
        mockHttpClient.listResources = jest.fn().mockResolvedValueOnce([
          {
            id: '1',
            id_reference: '1',
            name: { language: [{ '#text': 'Click and collect' }] },
            active: '1',
            deleted: '0',
          },
        ]);

        const result = await adapter.listCarriers();

        expect(result).toEqual([{ value: '1', label: 'Click and collect' }]);
      });

      it('returns empty array when PS reports no carriers', async () => {
        mockHttpClient.listResources = jest.fn().mockResolvedValueOnce([]);
        await expect(adapter.listCarriers()).resolves.toEqual([]);
      });
    });

    describe('listOrderStatuses', () => {
      it('returns non-deleted order_states keyed by id', async () => {
        mockHttpClient.listResources = jest.fn().mockResolvedValueOnce([
          { id: '1', name: 'Awaiting check payment', deleted: '0' },
          { id: '2', name: 'Payment accepted', deleted: '0' },
          { id: '5', name: 'Delivered', deleted: '0' },
        ]);

        const result = await adapter.listOrderStatuses();

        expect(mockHttpClient.listResources).toHaveBeenCalledWith(
          'order_states',
          { custom: { deleted: '0' } },
          1000,
          0,
        );
        expect(result).toEqual([
          { value: '1', label: 'Awaiting check payment' },
          { value: '2', label: 'Payment accepted' },
          { value: '5', label: 'Delivered' },
        ]);
      });
    });

    describe('listPaymentMethods (#483)', () => {
      function adapterWithOverrides(overrides: string[] | undefined): PrestashopOrderProcessorManagerAdapter {
        const baseConfig = connection.config as Record<string, unknown>;
        const cfg: Record<string, unknown> =
          overrides === undefined
            ? baseConfig
            : { ...baseConfig, paymentModuleOverrides: overrides };
        const connectionWithOverrides = createTestConnection({
          config: cfg,
        });
        return new PrestashopOrderProcessorManagerAdapter(
          mockHttpClient,
          mockIdentifierMapping,
          mockOrderMapper,
          connectionWithOverrides,
          mockCustomerProvisioner,
          mockAddressProvisioner,
          mockCurrencyResolver,
          mockCustomerProjectionRepository,
        );
      }

      it('returns the curated list verbatim when no overrides are configured', async () => {
        mockHttpClient.listResources = jest.fn();

        const result = await adapter.listPaymentMethods();

        // PS WS keys cannot read /api/modules — the adapter must not call it.
        expect(mockHttpClient.listResources).not.toHaveBeenCalled();
        // Curated list covers ps_wirepayment, payu, etc.; spot-check a few entries.
        expect(result).toEqual(
          expect.arrayContaining([
            { value: 'ps_wirepayment', label: 'Bank wire transfer (ps_wirepayment)' },
            { value: 'payu', label: 'PayU' },
            { value: 'paypal', label: 'PayPal' },
          ]),
        );
        // All values are unique.
        const values = result.map((m) => m.value);
        expect(new Set(values).size).toBe(values.length);
      });

      it('appends override entries to the curated list', async () => {
        const overrideAdapter = adapterWithOverrides(['custom_gateway_xyz']);
        mockHttpClient.listResources = jest.fn();

        const result = await overrideAdapter.listPaymentMethods();

        expect(mockHttpClient.listResources).not.toHaveBeenCalled();
        expect(result).toContainEqual({
          value: 'custom_gateway_xyz',
          label: 'custom_gateway_xyz',
        });
      });

      it('dedups overrides whose value collides with a curated entry', async () => {
        // 'payu' is already in the curated list — must not appear twice and
        // the curated label must win.
        const overrideAdapter = adapterWithOverrides(['payu', 'unique_override']);

        const result = await overrideAdapter.listPaymentMethods();

        const payuEntries = result.filter((m) => m.value === 'payu');
        expect(payuEntries).toHaveLength(1);
        expect(payuEntries[0].label).toBe('PayU');
        expect(result).toContainEqual({
          value: 'unique_override',
          label: 'unique_override',
        });
      });

      it('dedups overrides whose value is repeated within the override list', async () => {
        const overrideAdapter = adapterWithOverrides(['custom_a', 'custom_a', 'custom_b']);

        const result = await overrideAdapter.listPaymentMethods();

        expect(result.filter((m) => m.value === 'custom_a')).toHaveLength(1);
        expect(result.filter((m) => m.value === 'custom_b')).toHaveLength(1);
      });
    });
  });
});

