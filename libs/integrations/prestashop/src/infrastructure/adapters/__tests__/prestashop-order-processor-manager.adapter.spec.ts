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
});

