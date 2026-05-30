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
import {
  PrestashopApiException,
  PrestashopResourceNotFoundException,
} from '@openlinker/integrations-prestashop';
import type { IPrestashopWebserviceClient } from '../../http/prestashop-webservice.client.interface';
import type { IPrestashopOpenLinkerModuleClient } from '../../http/prestashop-openlinker-module.client.interface';
import { PrestashopOlModuleException } from '../../../domain/exceptions/prestashop-ol-module.exception';
import type {
  IPrestashopOrderMapper,
  PrestashopOrder,
} from '../../mappers/prestashop.mapper.interface';
import type { IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { OrderCreate } from '@openlinker/core/orders';
import type { IMappingConfigService } from '@openlinker/core/mappings';
import type { PrestashopCurrencyResolver } from '../../provisioners/prestashop-currency-resolver';
import type { PrestashopTaxRateResolver } from '../../provisioners/prestashop-tax-rate.resolver';
import type { CustomerProjectionRepositoryPort } from '@openlinker/core/customers';
import type { PrestashopCustomerProvisioner } from '../../provisioners/prestashop-customer-provisioner';
import type { PrestashopAddressProvisioner } from '../../provisioners/prestashop-address-provisioner';

/**
 * The numeric `id_carrier` returned by the OL module's discovery row in
 * these tests. Picked so it doesn't collide with any other carrier id used
 * in the suite (#455 mapping tests use 4, fixture defaultCarrierId tests
 * use 7). Tests that need to assert the OL Dynamic fallback compare against
 * this constant.
 */
const OL_DYNAMIC_CARRIER_ID = 99;

describe('PrestashopOrderProcessorManagerAdapter', () => {
  let adapter: PrestashopOrderProcessorManagerAdapter;
  let mockHttpClient: jest.Mocked<IPrestashopWebserviceClient>;
  let mockIdentifierMapping: jest.Mocked<IdentifierMappingPort>;
  let mockOrderMapper: jest.Mocked<IPrestashopOrderMapper>;
  let mockCurrencyResolver: jest.Mocked<PrestashopCurrencyResolver>;
  let mockTaxRateResolver: PrestashopTaxRateResolver;
  let mockCustomerProjectionRepository: jest.Mocked<CustomerProjectionRepositoryPort>;
  let mockCustomerProvisioner: jest.Mocked<PrestashopCustomerProvisioner>;
  let mockAddressProvisioner: jest.Mocked<PrestashopAddressProvisioner>;
  let mockOpenLinkerModuleClient: jest.Mocked<IPrestashopOpenLinkerModuleClient>;
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

    mockTaxRateResolver = {
      // Default: untaxed (net == gross) so existing assertions are unaffected.
      resolveProductTaxRate: jest.fn().mockResolvedValue(0),
    } as unknown as PrestashopTaxRateResolver;

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

    mockOpenLinkerModuleClient = {
      writeCartShipping: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<IPrestashopOpenLinkerModuleClient>;

    // Default OL Dynamic carrier discovery: every createOrder call invokes
    // `discoverDynamicCarrierId()` early, which calls
    // `httpClient.listResources('carriers', { custom: { external_module_name: 'openlinker' } }, …)`.
    // Tests in this suite that reassign `listResources` must remember to
    // re-mock this path (none in createOrder do; the listCarriers /
    // listOrderStatuses / listPaymentMethods describes don't go through
    // createOrder, so they're unaffected).
    mockHttpClient.listResources = jest
      .fn()
      .mockImplementation((resource: string, params?: { custom?: Record<string, unknown> }) => {
        if (resource === 'carriers' && params?.custom?.external_module_name === 'openlinker') {
          return Promise.resolve([{ id: OL_DYNAMIC_CARRIER_ID, active: '1', deleted: '0' }]);
        }
        return Promise.resolve([]);
      });

    adapter = new PrestashopOrderProcessorManagerAdapter(
      mockHttpClient,
      mockIdentifierMapping,
      mockOrderMapper,
      connection,
      mockCustomerProvisioner,
      mockAddressProvisioner,
      mockCurrencyResolver,
      mockCustomerProjectionRepository,
      mockOpenLinkerModuleClient,
      mockTaxRateResolver
    );
  });

  /**
   * Dispatch `createResource` by resource name so the order-creation flow's
   * intermediate `specific_prices` pins (#895) don't consume the cart/order
   * slots the way sequential `mockResolvedValueOnce` did.
   */
  function setCreateResourceDispatch(cart: unknown, order: unknown): void {
    mockHttpClient.createResource = jest.fn().mockImplementation((resource: string) => {
      if (resource === 'orders') {
        return Promise.resolve(order);
      }
      if (resource === 'specific_prices') {
        return Promise.resolve({ id: 'sp_test' });
      }
      // 'carts' (and any other resource hit during create) → cart payload.
      return Promise.resolve(cart);
    });
  }

  describe('createOrder', () => {
    it('should create order successfully with all IDs resolved', async () => {
      const order = createTestOrder();
      const externalCustomerId = '42';
      const externalProductId1 = '100';
      const externalProductId2 = '200';
      const externalVariantId = '300';

      // Mock customer ID resolution
      mockIdentifierMapping.getExternalIds = jest
        .fn()
        .mockImplementation((entityType, internalId) => {
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
      setCreateResourceDispatch(createdCart, createdOrder);

      // Mock identifier mapping creation
      mockIdentifierMapping.createMapping = jest.fn().mockResolvedValue(undefined);

      const result = await adapter.createOrder(order);

      expect(mockIdentifierMapping.getExternalIds).toHaveBeenCalledWith(
        'Customer',
        'internal-customer-123'
      );
      expect(mockIdentifierMapping.getExternalIds).toHaveBeenCalledWith(
        'Product',
        'internal-product-456'
      );
      expect(mockIdentifierMapping.getExternalIds).toHaveBeenCalledWith(
        'Product',
        'internal-product-789'
      );
      expect(mockIdentifierMapping.getExternalIds).toHaveBeenCalledWith(
        'ProductVariant',
        'internal-variant-789'
      );
      // #503: cart MUST be called with the same externalCarrierId as the
      // order body. PS resolves id_carrier from the cart, ignoring the order
      // body's field — so omitting it here lands every order at id_carrier=0.
      expect(mockOrderMapper.mapCartCreate).toHaveBeenCalledWith(
        order,
        externalCustomerId,
        expect.any(Map),
        expect.any(Map),
        undefined,
        undefined,
        1, // currencyId
        1, // langId
        OL_DYNAMIC_CARRIER_ID // #516: no mapping/default → OL Dynamic carrier fallback
      );
      expect(mockOrderMapper.mapOrderCreate).toHaveBeenCalledWith(
        order,
        externalCustomerId,
        expect.any(Map),
        expect.any(Map),
        undefined,
        undefined,
        1, // currencyId
        1, // langId
        OL_DYNAMIC_CARRIER_ID // #516: no mapping/default → OL Dynamic carrier fallback
      );
      expect(mockHttpClient.createResource).toHaveBeenCalledWith('carts', expect.any(Object));
      expect(mockHttpClient.createResource).toHaveBeenCalledWith('orders', prestashopOrderData);
      // #909: the adapter no longer writes the order mapping — OrderSyncService owns it.
      expect(mockIdentifierMapping.createMapping).not.toHaveBeenCalled();
      // Returns the destination-native PS order id, not the internal id.
      expect(result).toEqual({
        orderId: '999',
        orderNumber: order.orderNumber,
      });
    });

    it('should recover the existing external order id on a PS duplicate-key error', async () => {
      const order = createTestOrder();
      mockIdentifierMapping.getExternalIds = jest
        .fn()
        .mockImplementation((entityType: string, internalId: string) => {
          if (entityType === 'Customer' && internalId === 'internal-customer-123') {
            return Promise.resolve([
              { connectionId: connection.id, externalId: '42', entityType: 'Customer' },
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
          if (entityType === 'ProductVariant' && internalId === 'internal-variant-789') {
            return Promise.resolve([
              { connectionId: connection.id, externalId: '300', entityType: 'ProductVariant' },
            ]);
          }
          return Promise.resolve([]);
        });
      mockOrderMapper.mapOrderCreate.mockReturnValue({
        id_customer: '42',
        current_state: 1,
        associations: { order_rows: { order_row: [] } },
      });

      // Cart + pins succeed; the order POST hits a unique-constraint error so the
      // adapter falls into its defense-in-depth recovery (#909): re-query PS by
      // reference and adopt the existing order's id.
      mockHttpClient.createResource = jest.fn().mockImplementation((resource: string) => {
        if (resource === 'carts') return Promise.resolve({ id: '123' });
        if (resource === 'specific_prices') return Promise.resolve({ id: 'sp_test' });
        if (resource === 'orders') {
          return Promise.reject(new Error('duplicate key value violates unique constraint'));
        }
        return Promise.resolve({ id: '1' });
      });
      mockHttpClient.listResources = jest
        .fn()
        .mockImplementation((resource: string, params?: { custom?: Record<string, unknown> }) => {
          if (resource === 'carriers' && params?.custom?.external_module_name === 'openlinker') {
            return Promise.resolve([{ id: OL_DYNAMIC_CARRIER_ID, active: '1', deleted: '0' }]);
          }
          if (resource === 'orders') {
            return Promise.resolve([{ id: '888', reference: 'TEST-ORDER-001' }]);
          }
          return Promise.resolve([]);
        });
      mockIdentifierMapping.createMapping = jest.fn().mockResolvedValue(undefined);

      const result = await adapter.createOrder(order);

      // Defense-in-depth recovery returns the recovered PS-native id (#909).
      expect(result.orderId).toBe('888');
      // The adapter still does not write the mapping — OrderSyncService owns it.
      expect(mockIdentifierMapping.createMapping).not.toHaveBeenCalled();
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
        'Cannot provision customer: customer projection not found or email missing'
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
        'Cannot provision customer: customer projection not found or email missing'
      );
    });

    it('should throw error when product ID not found in PrestaShop', async () => {
      const order = createTestOrder();
      mockIdentifierMapping.getExternalIds = jest
        .fn()
        .mockImplementation((entityType, internalId) => {
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

      mockIdentifierMapping.getExternalIds = jest
        .fn()
        .mockImplementation((entityType, internalId) => {
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

      mockIdentifierMapping.getExternalIds = jest
        .fn()
        .mockImplementation((entityType, internalId) => {
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
      const apiError = new PrestashopApiException(
        'Order creation failed',
        400,
        'Invalid order data'
      );
      mockHttpClient.createResource = jest.fn().mockImplementation((resource: string) => {
        if (resource === 'carts') {
          return Promise.resolve(createdCart);
        }
        if (resource === 'specific_prices') {
          // Pins succeed; this test exercises the order-POST failure path.
          return Promise.resolve({ id: 'sp_test' });
        }
        if (resource === 'orders') {
          return Promise.reject(apiError);
        }
        return Promise.reject(new Error(`Unexpected resource: ${resource}`));
      });

      await expect(adapter.createOrder(order)).rejects.toThrow(PrestashopApiException);
      await expect(adapter.createOrder(order)).rejects.toThrow('Order creation failed');
    });


    it('should use created order reference if order number not provided', async () => {
      const order = createTestOrder({ orderNumber: undefined });
      const externalCustomerId = '42';
      const externalProductId1 = '100';
      const externalProductId2 = '200';
      const externalVariantId = '300';

      mockIdentifierMapping.getExternalIds = jest
        .fn()
        .mockImplementation((entityType, internalId) => {
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
      // #909: mapping write is owned by OrderSyncService, not the adapter.
      expect(mockIdentifierMapping.createMapping).not.toHaveBeenCalled();
    });


    describe('source-authoritative line pricing (#895)', () => {
      type CreateCall = [string, Record<string, unknown>];
      const createCalls = (): CreateCall[] =>
        (mockHttpClient.createResource as jest.Mock).mock.calls as CreateCall[];
      const specificPriceFor = (productId: string): Record<string, unknown> | undefined =>
        createCalls()
          .filter((c) => c[0] === 'specific_prices')
          .find((c) => c[1].id_product === productId)?.[1];

      const resolveIds = (
        entityType: string,
        internalId: string
      ): Promise<Array<{ connectionId: string; externalId: string; entityType: string }>> => {
        const map: Record<string, Record<string, string>> = {
          Customer: { 'internal-customer-123': '42' },
          Product: { 'internal-product-456': '100', 'internal-product-789': '200' },
          ProductVariant: { 'internal-variant-789': '300' },
        };
        const externalId = map[entityType]?.[internalId];
        return Promise.resolve(
          externalId ? [{ connectionId: connection.id, externalId, entityType }] : []
        );
      };

      const arrange = (): void => {
        mockIdentifierMapping.getExternalIds = jest
          .fn()
          .mockImplementation((entityType: string, internalId: string) =>
            entityType === 'Order' ? Promise.resolve([]) : resolveIds(entityType, internalId)
          );
        mockOrderMapper.mapOrderCreate.mockReturnValue({
          id_customer: '42',
          current_state: 1,
          associations: { order_rows: { order_row: [] } },
        });
        setCreateResourceDispatch(
          { id: '123' },
          { id: '999', reference: 'TEST-ORDER-001' } as PrestashopOrder
        );
        mockIdentifierMapping.createMapping = jest.fn().mockResolvedValue(undefined);
      };

      it('pins each line net via cart-scoped specific_prices before POST /orders, then cleans up', async () => {
        arrange();
        (mockTaxRateResolver.resolveProductTaxRate as jest.Mock).mockResolvedValue(0.23);

        await adapter.createOrder(
          createTestOrder({
            totals: {
              subtotal: 109.97,
              tax: 0,
              shipping: 5.0,
              total: 114.97,
              currency: 'EUR',
              taxTreatment: 'inclusive',
            },
          })
        );

        const calls = createCalls();
        expect(calls.filter((c) => c[0] === 'specific_prices')).toHaveLength(2);

        // Line 1: gross 29.99 → net 29.99 / 1.23.
        const line1 = specificPriceFor('100');
        expect(line1?.price).toBe((29.99 / 1.23).toFixed(6));
        expect(line1?.id_cart).toBe('123');
        expect(line1?.id_customer).toBe('42');
        expect(line1?.from_quantity).toBe(1);

        // specific_prices must be written BEFORE the order POST.
        const firstOrderIdx = calls.findIndex((c) => c[0] === 'orders');
        const lastSpecificIdx = calls.map((c) => c[0]).lastIndexOf('specific_prices');
        expect(lastSpecificIdx).toBeLessThan(firstOrderIdx);

        // Pins are cleaned up after the order is created.
        expect(mockHttpClient.deleteResource).toHaveBeenCalledWith('specific_prices', 'sp_test');
      });

      it('pins the price as-is (no tax conversion) when the source reports net prices', async () => {
        arrange();

        await adapter.createOrder(
          createTestOrder({
            totals: {
              subtotal: 109.97,
              tax: 0,
              shipping: 5.0,
              total: 114.97,
              currency: 'EUR',
              taxTreatment: 'exclusive',
            },
          })
        );

        // Net source → no rate lookup, price pinned verbatim.
        expect(mockTaxRateResolver.resolveProductTaxRate).not.toHaveBeenCalled();
        expect(specificPriceFor('100')?.price).toBe((29.99).toFixed(6));
      });

      it('fails loudly (does not create the order) when a line price cannot be pinned', async () => {
        arrange();
        // PS rejects the specific_price write → must abort before POST /orders
        // rather than silently create a catalog-priced order (ADR-014 invariant).
        mockHttpClient.createResource = jest.fn().mockImplementation((resource: string) => {
          if (resource === 'specific_prices') {
            return Promise.reject(new Error('PS rejected specific_price'));
          }
          if (resource === 'orders') {
            return Promise.resolve({ id: '999', reference: 'TEST-ORDER-001' } as PrestashopOrder);
          }
          return Promise.resolve({ id: '123' });
        });

        await expect(
          adapter.createOrder(
            createTestOrder({
              totals: {
                subtotal: 109.97,
                tax: 0,
                shipping: 5.0,
                total: 114.97,
                currency: 'EUR',
                taxTreatment: 'inclusive',
              },
            })
          )
        ).rejects.toThrow(/pin source-authoritative price/);

        // The order POST must NOT have happened.
        expect(createCalls().map((c) => c[0])).not.toContain('orders');
      });
    });


    it('should handle generic errors and wrap in PrestashopApiException', async () => {
      const order = createTestOrder();
      const externalCustomerId = '42';

      mockIdentifierMapping.getExternalIds = jest
        .fn()
        .mockImplementation((entityType, internalId) => {
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
      mockIdentifierMapping.getExternalIds = jest
        .fn()
        .mockImplementation((entityType, internalId) => {
          if (entityType === 'Customer') {
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

      setCreateResourceDispatch({ id: '123' }, {
        id: '999',
        reference: 'TEST-ORDER-001',
      } as PrestashopOrder);

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
        mockOpenLinkerModuleClient,
        mockTaxRateResolver,
        mockMappingConfig
      );

      await adapterWithMapping.createOrder(buildOrderWithShipping());

      // 9th arg = externalCarrierId — passed to BOTH mappers (#503).
      // Cart-side is the load-bearing assertion: PS resolves the order's
      // id_carrier from the cart, ignoring the order body's value.
      expect(mockOrderMapper.mapCartCreate).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.any(Map),
        expect.any(Map),
        undefined,
        undefined,
        1,
        1,
        4
      );
      expect(mockOrderMapper.mapOrderCreate).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.any(Map),
        expect.any(Map),
        undefined,
        undefined,
        1,
        1,
        4
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
        mockOpenLinkerModuleClient,
        mockTaxRateResolver,
        mockMappingConfig
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
        7
      );
    });

    it('ignores invalid defaultCarrierId (0, negative, NaN) and falls back to OL Dynamic carrier (#503 / #516)', async () => {
      // Operator sets defaultCarrierId=0 (or negative, or non-numeric) in
      // connection config. Without the guard, the mapper writes id_carrier=0
      // to the cart and PS reproduces the #503 failure mode through a
      // different door — `??` doesn't fall back on 0, only null/undefined.
      // Adapter must filter and use the OL Dynamic carrier id (#516).
      wireSuccessfulMappings('42');
      const connWithBadDefault = createTestConnection();
      (connWithBadDefault.config as Record<string, unknown>).defaultCarrierId = 0;

      const mockMappingConfig = {
        resolveCarrierMapping: jest.fn().mockResolvedValue(null),
      } as unknown as IMappingConfigService;
      const adapterWithMapping = new PrestashopOrderProcessorManagerAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        mockOrderMapper,
        connWithBadDefault,
        mockCustomerProvisioner,
        mockAddressProvisioner,
        mockCurrencyResolver,
        mockCustomerProjectionRepository,
        mockOpenLinkerModuleClient,
        mockTaxRateResolver,
        mockMappingConfig
      );

      await adapterWithMapping.createOrder(buildOrderWithShipping());

      expect(mockOrderMapper.mapCartCreate).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.any(Map),
        expect.any(Map),
        undefined,
        undefined,
        1,
        1,
        OL_DYNAMIC_CARRIER_ID
      );
      expect(mockOrderMapper.mapOrderCreate).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.any(Map),
        expect.any(Map),
        undefined,
        undefined,
        1,
        1,
        OL_DYNAMIC_CARRIER_ID
      );
    });

    it('falls back to OL Dynamic carrier when neither mapping nor defaultCarrierId is set (#516)', async () => {
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
        mockOpenLinkerModuleClient,
        mockTaxRateResolver,
        mockMappingConfig
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
        OL_DYNAMIC_CARRIER_ID
      );
    });
  });

  describe('OL module sidecar write (#516)', () => {
    const ALLEGRO_CONNECTION_ID = 'conn-allegro-1';
    const ALLEGRO_METHOD_ID = 'method-courier';
    const STATIC_CARRIER_ID = 4;

    const buildOrderForSidecar = (shipping = 12.5): OrderCreate => ({
      ...createTestOrder(),
      shipping: { methodId: ALLEGRO_METHOD_ID, methodName: 'InPost Paczkomat' },
      source: { connectionId: ALLEGRO_CONNECTION_ID },
      totals: {
        subtotal: 109.97,
        tax: 10.0,
        shipping,
        total: 109.97 + 10.0 + shipping,
        currency: 'EUR',
      },
    });

    const wireSuccessfulCreatePath = (): void => {
      mockIdentifierMapping.getExternalIds = jest.fn().mockImplementation((entityType: string) => {
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

      mockOrderMapper.mapOrderCreate.mockReturnValue({
        id_customer: '42',
        current_state: 1,
        associations: { order_rows: { order_row: [] } },
      });

      setCreateResourceDispatch({ id: '123' }, {
        id: '999',
        reference: 'TEST-ORDER-001',
      } as PrestashopOrder);

      mockIdentifierMapping.createMapping = jest.fn().mockResolvedValue(undefined);
    };

    it('writes the sidecar row when the resolved carrier is the OL Dynamic carrier (mapping branch)', async () => {
      wireSuccessfulCreatePath();
      const mockMappingConfig = {
        // Mapping resolves to the OL Dynamic carrier id — adapter must write the sidecar.
        resolveCarrierMapping: jest.fn().mockResolvedValue(String(OL_DYNAMIC_CARRIER_ID)),
      } as unknown as IMappingConfigService;
      const adapterUnderTest = new PrestashopOrderProcessorManagerAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        mockOrderMapper,
        connection,
        mockCustomerProvisioner,
        mockAddressProvisioner,
        mockCurrencyResolver,
        mockCustomerProjectionRepository,
        mockOpenLinkerModuleClient,
        mockTaxRateResolver,
        mockMappingConfig
      );

      await adapterUnderTest.createOrder(buildOrderForSidecar(12.5));

      expect(mockOpenLinkerModuleClient.writeCartShipping).toHaveBeenCalledTimes(1);
      expect(mockOpenLinkerModuleClient.writeCartShipping).toHaveBeenCalledWith(
        expect.objectContaining({
          idCart: 123,
          amountTaxExcl: 12.5,
          amountTaxIncl: 12.5,
          source: expect.stringContaining(`connection:${ALLEGRO_CONNECTION_ID}`),
        })
      );
    });

    it('does NOT write the sidecar when a static carrier id is resolved via mapping', async () => {
      wireSuccessfulCreatePath();
      const mockMappingConfig = {
        resolveCarrierMapping: jest.fn().mockResolvedValue(String(STATIC_CARRIER_ID)),
      } as unknown as IMappingConfigService;
      const adapterUnderTest = new PrestashopOrderProcessorManagerAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        mockOrderMapper,
        connection,
        mockCustomerProvisioner,
        mockAddressProvisioner,
        mockCurrencyResolver,
        mockCustomerProjectionRepository,
        mockOpenLinkerModuleClient,
        mockTaxRateResolver,
        mockMappingConfig
      );

      await adapterUnderTest.createOrder(buildOrderForSidecar());

      expect(mockOpenLinkerModuleClient.writeCartShipping).not.toHaveBeenCalled();
    });

    it('does NOT write the sidecar when defaultCarrierId resolves to a static carrier', async () => {
      wireSuccessfulCreatePath();
      const connWithStaticDefault = createTestConnection();
      (connWithStaticDefault.config as Record<string, unknown>).defaultCarrierId =
        STATIC_CARRIER_ID;
      const mockMappingConfig = {
        resolveCarrierMapping: jest.fn().mockResolvedValue(null),
      } as unknown as IMappingConfigService;
      const adapterUnderTest = new PrestashopOrderProcessorManagerAdapter(
        mockHttpClient,
        mockIdentifierMapping,
        mockOrderMapper,
        connWithStaticDefault,
        mockCustomerProvisioner,
        mockAddressProvisioner,
        mockCurrencyResolver,
        mockCustomerProjectionRepository,
        mockOpenLinkerModuleClient,
        mockTaxRateResolver,
        mockMappingConfig
      );

      await adapterUnderTest.createOrder(buildOrderForSidecar());

      expect(mockOpenLinkerModuleClient.writeCartShipping).not.toHaveBeenCalled();
    });

    it('writes the sidecar when no mapping/default resolves and falls back to OL Dynamic', async () => {
      // No MappingConfigService and no defaultCarrierId — adapter falls
      // back to the OL Dynamic carrier and must therefore write the sidecar.
      wireSuccessfulCreatePath();

      await adapter.createOrder(buildOrderForSidecar(8.0));

      expect(mockOpenLinkerModuleClient.writeCartShipping).toHaveBeenCalledTimes(1);
      expect(mockOpenLinkerModuleClient.writeCartShipping).toHaveBeenCalledWith(
        expect.objectContaining({
          idCart: 123,
          amountTaxExcl: 8.0,
          amountTaxIncl: 8.0,
        })
      );
    });

    it('aborts order creation (does NOT POST /orders) when the sidecar write throws', async () => {
      wireSuccessfulCreatePath();
      const sidecarError = new PrestashopOlModuleException(
        connection.id,
        123,
        500,
        'persist-failed'
      );
      mockOpenLinkerModuleClient.writeCartShipping.mockRejectedValueOnce(sidecarError);

      // Adapter wraps non-domain errors in PrestashopApiException ("Failed to
      // create PrestaShop order: …"); the underlying reason is preserved in
      // the message.
      await expect(adapter.createOrder(buildOrderForSidecar())).rejects.toThrow(
        PrestashopApiException
      );

      // createResource was called once (cart), never twice (cart + order).
      expect(mockHttpClient.createResource).toHaveBeenCalledTimes(1);
      expect(mockHttpClient.createResource).toHaveBeenCalledWith('carts', expect.anything());
    });

    it('warns and uses the first live row when multiple OL Dynamic carriers exist', async () => {
      // Operator cloned the OL Dynamic carrier in BO (or a botched migration
      // double-inserted). The adapter must keep working but warn so the
      // operator notices and cleans up.
      wireSuccessfulCreatePath();
      const warnSpy = jest
        .spyOn((adapter as unknown as { logger: { warn: jest.Mock } }).logger, 'warn')
        .mockImplementation(() => undefined);

      mockHttpClient.listResources = jest
        .fn()
        .mockImplementation((resource: string, params?: { custom?: Record<string, unknown> }) => {
          if (resource === 'carriers' && params?.custom?.external_module_name === 'openlinker') {
            return Promise.resolve([
              { id: OL_DYNAMIC_CARRIER_ID, active: '1', deleted: '0' },
              { id: OL_DYNAMIC_CARRIER_ID + 1, active: '1', deleted: '0' },
            ]);
          }
          return Promise.resolve([]);
        });

      await adapter.createOrder(buildOrderForSidecar(8.0));

      // First-row id was used for both the cart's id_carrier and the sidecar.
      expect(mockOrderMapper.mapCartCreate).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.any(Map),
        expect.any(Map),
        undefined,
        undefined,
        1,
        1,
        OL_DYNAMIC_CARRIER_ID
      );
      expect(mockOpenLinkerModuleClient.writeCartShipping).toHaveBeenCalledTimes(1);
      // Operator-visible warn naming the duplicate set.
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Multiple live OL Dynamic carrier rows')
      );
      warnSpy.mockRestore();
    });

    it('aborts when the OL Dynamic carrier row returns a non-positive id (PS WS trust-boundary guard)', async () => {
      // PS WS edge: the row exists but `id` decodes to NaN / 0 / negative
      // (operator BO edit, schema drift). Adapter must NOT propagate
      // id_carrier=NaN into the cart mapper — treat as missing instead.
      wireSuccessfulCreatePath();
      mockHttpClient.listResources = jest
        .fn()
        .mockImplementation((resource: string, params?: { custom?: Record<string, unknown> }) => {
          if (resource === 'carriers' && params?.custom?.external_module_name === 'openlinker') {
            return Promise.resolve([{ id: 'not-a-number', active: '1', deleted: '0' }]);
          }
          return Promise.resolve([]);
        });

      await expect(adapter.createOrder(buildOrderForSidecar())).rejects.toThrow(
        PrestashopApiException
      );
      expect(mockHttpClient.createResource).not.toHaveBeenCalled();
      expect(mockOpenLinkerModuleClient.writeCartShipping).not.toHaveBeenCalled();
    });

    it('aborts before any PS write when the OL module is not installed (carrier discovery empty)', async () => {
      wireSuccessfulCreatePath();
      // Override the discovery default with an empty result — operator
      // hasn't installed/activated the OL module.
      mockHttpClient.listResources = jest
        .fn()
        .mockImplementation((resource: string, params?: { custom?: Record<string, unknown> }) => {
          if (resource === 'carriers' && params?.custom?.external_module_name === 'openlinker') {
            return Promise.resolve([]);
          }
          return Promise.resolve([]);
        });

      await expect(adapter.createOrder(buildOrderForSidecar())).rejects.toThrow(
        PrestashopApiException
      );

      // No cart, no order, no sidecar — discovery threw before any write.
      expect(mockHttpClient.createResource).not.toHaveBeenCalled();
      expect(mockOpenLinkerModuleClient.writeCartShipping).not.toHaveBeenCalled();
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
      setCreateResourceDispatch({ id: '123' }, {
        id: '999',
        reference: 'TEST-ORDER-001',
      } as PrestashopOrder);
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
        order.pickupPoint
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
          0
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

      it("marks the OL Dynamic carrier with kind='dynamic' (#517) when external_module_name='openlinker'", async () => {
        // The OL PS module installs the carrier with
        // `external_module_name='openlinker'` (#515 / #524). FE relies on
        // `kind: 'dynamic'` to decorate the dropdown — runtime routing is
        // already handled by the order-processor adapter (#516).
        mockHttpClient.listResources = jest.fn().mockResolvedValueOnce([
          { id: '1', id_reference: '1', name: 'Click and collect', active: '1', deleted: '0' },
          {
            id: '99',
            id_reference: '99',
            name: 'OpenLinker Dynamic',
            active: '1',
            deleted: '0',
            external_module_name: 'openlinker',
          },
          { id: '4', id_reference: '4', name: 'My light carrier', active: '1', deleted: '0' },
        ]);

        const result = await adapter.listCarriers();

        // OL Dynamic carries kind='dynamic'; siblings stay static (no kind).
        expect(result).toEqual([
          { value: '1', label: 'Click and collect' },
          { value: '99', label: 'OpenLinker Dynamic', kind: 'dynamic' },
          { value: '4', label: 'My light carrier' },
        ]);
      });

      it('treats unrelated external_module_name values as static (no kind set)', async () => {
        // Defensive: if some other PS carrier module ships with its own
        // `external_module_name` (e.g. a third-party InPost integration),
        // we don't accidentally light it up as dynamic. Only the literal
        // `'openlinker'` value enables the discriminator.
        mockHttpClient.listResources = jest.fn().mockResolvedValueOnce([
          {
            id: '7',
            id_reference: '7',
            name: 'Some other carrier module',
            active: '1',
            deleted: '0',
            external_module_name: 'thirdparty_carrier',
          },
        ]);

        const result = await adapter.listCarriers();

        expect(result).toEqual([{ value: '7', label: 'Some other carrier module' }]);
        expect(result[0]).not.toHaveProperty('kind');
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
          0
        );
        expect(result).toEqual([
          { value: '1', label: 'Awaiting check payment' },
          { value: '2', label: 'Payment accepted' },
          { value: '5', label: 'Delivered' },
        ]);
      });
    });

    describe('listPaymentMethods (#483)', () => {
      function adapterWithOverrides(
        overrides: string[] | undefined
      ): PrestashopOrderProcessorManagerAdapter {
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
          mockOpenLinkerModuleClient,
          mockTaxRateResolver
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
          ])
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

  describe('updateFulfillment (#858)', () => {
    const PS_ORDER_ID = '5001';
    const SHIPPED_STATE_ID = 4;

    beforeEach(() => {
      mockOrderMapper.mapStatusToPrestashopStateId = jest.fn().mockReturnValue(SHIPPED_STATE_ID);
    });

    it('should transition state via POST order_histories with sendmail when not in the target state', async () => {
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValue({ id: PS_ORDER_ID, current_state: '2', id_carrier: 7 });

      await adapter.updateFulfillment({ externalOrderId: PS_ORDER_ID, status: 'shipped' });

      expect(mockOrderMapper.mapStatusToPrestashopStateId).toHaveBeenCalledWith('shipped');
      // sendmail=1 (the buyer "shipped" email) is requested via the typed option.
      expect(mockHttpClient.createResource).toHaveBeenCalledWith(
        'order_histories',
        { id_order: PS_ORDER_ID, id_order_state: SHIPPED_STATE_ID },
        { sendEmail: true }
      );
    });

    it('should skip the order_histories POST when already in the target state (idempotent)', async () => {
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValue({ id: PS_ORDER_ID, current_state: '4', id_carrier: 7 });

      await adapter.updateFulfillment({ externalOrderId: PS_ORDER_ID, status: 'shipped' });

      // No order_histories POST at all (covers both the 3-arg and a future 2-arg shape).
      expect(mockHttpClient.createResource).not.toHaveBeenCalledWith(
        'order_histories',
        expect.anything()
      );
      expect(mockHttpClient.createResource).not.toHaveBeenCalledWith(
        'order_histories',
        expect.anything(),
        expect.anything()
      );
    });

    it('should write tracking BEFORE transitioning state (irreversible email last)', async () => {
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValue({ id: PS_ORDER_ID, current_state: '2', id_carrier: 7 });
      mockHttpClient.listResources = jest
        .fn()
        .mockImplementation((resource: string) =>
          resource === 'order_carriers'
            ? Promise.resolve([
                { id: '900', id_order: PS_ORDER_ID, id_carrier: 7, tracking_number: '' },
              ])
            : Promise.resolve([])
        );

      await adapter.updateFulfillment({
        externalOrderId: PS_ORDER_ID,
        status: 'shipped',
        trackingNumber: 'TRACK-9',
      });

      // Tracking (updateResource on order_carriers) must precede the
      // order_histories POST, so the shipped email renders the tracking link.
      const trackingOrder = mockHttpClient.updateResource.mock.invocationCallOrder[0];
      const historyOrder = mockHttpClient.createResource.mock.invocationCallOrder[0];
      expect(trackingOrder).toBeLessThan(historyOrder);
    });

    it('should write tracking by full-replacing the existing order_carriers row', async () => {
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValue({ id: PS_ORDER_ID, current_state: '4', id_carrier: 7 });
      const carrierRow = {
        id: '900',
        id_order: PS_ORDER_ID,
        id_carrier: 7,
        weight: '1.2',
        tracking_number: '',
      };
      mockHttpClient.listResources = jest
        .fn()
        .mockImplementation((resource: string) =>
          resource === 'order_carriers' ? Promise.resolve([carrierRow]) : Promise.resolve([])
        );

      await adapter.updateFulfillment({
        externalOrderId: PS_ORDER_ID,
        status: 'shipped',
        trackingNumber: 'TRACK-9',
      });

      expect(mockHttpClient.updateResource).toHaveBeenCalledWith('order_carriers', '900', {
        ...carrierRow,
        tracking_number: 'TRACK-9',
      });
    });

    it('should write tracking to the max-id order_carriers row when several exist (re-ship)', async () => {
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValue({ id: PS_ORDER_ID, current_state: '4', id_carrier: 7 });
      mockHttpClient.listResources = jest
        .fn()
        .mockImplementation((resource: string) =>
          resource === 'order_carriers'
            ? Promise.resolve([
                { id: '900', id_order: PS_ORDER_ID, id_carrier: 7, tracking_number: '' },
                { id: '905', id_order: PS_ORDER_ID, id_carrier: 9, tracking_number: '' },
              ])
            : Promise.resolve([])
        );

      await adapter.updateFulfillment({
        externalOrderId: PS_ORDER_ID,
        status: 'shipped',
        trackingNumber: 'TRACK-9',
      });

      // The current carrier is the highest id (905), not rows[0] (900).
      expect(mockHttpClient.updateResource).toHaveBeenCalledWith(
        'order_carriers',
        '905',
        expect.objectContaining({ tracking_number: 'TRACK-9' })
      );
    });

    it('should warn and skip (not fabricate) when no order_carriers row exists', async () => {
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValue({ id: PS_ORDER_ID, current_state: '4', id_carrier: 7 });
      mockHttpClient.listResources = jest.fn().mockResolvedValue([]);

      await adapter.updateFulfillment({
        externalOrderId: PS_ORDER_ID,
        status: 'shipped',
        trackingNumber: 'TRACK-9',
      });

      // No fabrication: neither a PUT nor a POST to order_carriers.
      expect(mockHttpClient.updateResource).not.toHaveBeenCalled();
      expect(mockHttpClient.createResource).not.toHaveBeenCalledWith(
        'order_carriers',
        expect.anything(),
        expect.anything()
      );
    });

    it('should skip the tracking write when the value is unchanged (idempotent)', async () => {
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValue({ id: PS_ORDER_ID, current_state: '4', id_carrier: 7 });
      mockHttpClient.listResources = jest
        .fn()
        .mockImplementation((resource: string) =>
          resource === 'order_carriers'
            ? Promise.resolve([
                { id: '900', id_order: PS_ORDER_ID, id_carrier: 7, tracking_number: 'TRACK-9' },
              ])
            : Promise.resolve([])
        );

      await adapter.updateFulfillment({
        externalOrderId: PS_ORDER_ID,
        status: 'shipped',
        trackingNumber: 'TRACK-9',
      });

      expect(mockHttpClient.updateResource).not.toHaveBeenCalled();
    });

    it('should not touch order_carriers when no trackingNumber is supplied', async () => {
      mockHttpClient.getResource = jest
        .fn()
        .mockResolvedValue({ id: PS_ORDER_ID, current_state: '2', id_carrier: 7 });

      await adapter.updateFulfillment({ externalOrderId: PS_ORDER_ID, status: 'shipped' });

      expect(mockHttpClient.listResources).not.toHaveBeenCalledWith(
        'order_carriers',
        expect.anything()
      );
      expect(mockHttpClient.updateResource).not.toHaveBeenCalled();
    });

    it('should wrap a WebService failure in PrestashopApiException', async () => {
      mockHttpClient.getResource = jest.fn().mockRejectedValue(new Error('WS 500'));

      await expect(
        adapter.updateFulfillment({ externalOrderId: PS_ORDER_ID, status: 'shipped' })
      ).rejects.toBeInstanceOf(PrestashopApiException);
    });
  });

  describe('getFulfillmentStatus (#834 — FulfillmentStatusReader)', () => {
    const PS_ORDER_ID = '5001';

    /**
     * Stub PS `getResource`/`listResources` paths needed by the
     * fulfillment-status read. The state map is loaded lazily on the first
     * `getFulfillmentStatus` call; subsequent calls reuse the cache, so the
     * `order_states` listResources call should fire exactly **once** per
     * adapter instance. Verified explicitly in the dedicated cache test.
     */
    beforeEach(() => {
      mockHttpClient.getResource = jest.fn().mockImplementation(
        (resource: string, _id: string | number) => {
          if (resource === 'orders') {
            return Promise.resolve({
              id: PS_ORDER_ID,
              current_state: '5',
              date_upd: '2026-05-28 14:00:00',
              shipping_number: 'PS-TRK-1',
            } as PrestashopOrder);
          }
          return Promise.resolve(null);
        }
      );
      // Keep the carrier-mapping path from the parent beforeEach intact,
      // add the order_states + order_carriers branches.
      mockHttpClient.listResources = jest
        .fn()
        .mockImplementation((resource: string, params?: { custom?: Record<string, unknown> }) => {
          if (resource === 'carriers' && params?.custom?.external_module_name === 'openlinker') {
            return Promise.resolve([{ id: OL_DYNAMIC_CARRIER_ID, active: '1', deleted: '0' }]);
          }
          if (resource === 'order_states') {
            return Promise.resolve([
              { id: '4', name: 'Awaiting payment', deleted: '0' },
              { id: '5', name: 'Shipped', deleted: '0', shipped: '1' },
              { id: '6', name: 'Delivered', deleted: '0', delivered: '1', shipped: '1' },
              { id: '7', name: 'Cancelled', deleted: '0' },
            ]);
          }
          if (resource === 'order_carriers') {
            return Promise.resolve([]);
          }
          return Promise.resolve([]);
        });
    });

    it('should project PS state.shipped=1 onto FulfillmentStatus.Dispatched with tracking', async () => {
      const snapshot = await adapter.getFulfillmentStatus({ externalOrderId: PS_ORDER_ID });

      expect(snapshot.status).toBe('dispatched');
      expect(snapshot.trackingNumber).toBe('PS-TRK-1');
      expect(snapshot.deliveredAt).toBeNull();
    });

    it('should cache the order_states map across calls (one listResources(order_states) per adapter instance)', async () => {
      await adapter.getFulfillmentStatus({ externalOrderId: PS_ORDER_ID });
      await adapter.getFulfillmentStatus({ externalOrderId: PS_ORDER_ID });
      await adapter.getFulfillmentStatus({ externalOrderId: PS_ORDER_ID });

      const orderStatesCalls = (mockHttpClient.listResources as jest.Mock).mock.calls.filter(
        (call: unknown[]) => call[0] === 'order_states'
      );
      expect(orderStatesCalls).toHaveLength(1);
    });

    it('should NOT fetch order_carriers when order.shipping_number is set (lazy WS optimisation)', async () => {
      // The default `beforeEach` returns an order with `shipping_number: 'PS-TRK-1'`,
      // so the carriers fetch should be skipped entirely.
      await adapter.getFulfillmentStatus({ externalOrderId: PS_ORDER_ID });
      await adapter.getFulfillmentStatus({ externalOrderId: PS_ORDER_ID });

      const orderCarriersCalls = (mockHttpClient.listResources as jest.Mock).mock.calls.filter(
        (call: unknown[]) => call[0] === 'order_carriers'
      );
      expect(orderCarriersCalls).toHaveLength(0);
    });

    it('should fetch order_carriers as fallback when shipping_number is empty', async () => {
      // Re-stub `getResource` so the order has NO shipping_number.
      mockHttpClient.getResource = jest.fn().mockResolvedValue({
        id: PS_ORDER_ID,
        current_state: '5',
        date_upd: '2026-05-28 14:00:00',
        // no shipping_number
      } as PrestashopOrder);
      // Carriers row with tracking — the mapper should pick it up.
      (mockHttpClient.listResources as jest.Mock).mockImplementation(
        (resource: string, params?: { custom?: Record<string, unknown> }) => {
          if (resource === 'carriers' && params?.custom?.external_module_name === 'openlinker') {
            return Promise.resolve([{ id: OL_DYNAMIC_CARRIER_ID, active: '1', deleted: '0' }]);
          }
          if (resource === 'order_states') {
            return Promise.resolve([
              { id: '5', name: 'Shipped', deleted: '0', shipped: '1' },
            ]);
          }
          if (resource === 'order_carriers') {
            return Promise.resolve([
              { id: '10', id_order: PS_ORDER_ID, id_carrier: '1', tracking_number: 'CARR-TRK-9' },
            ]);
          }
          return Promise.resolve([]);
        },
      );

      const snapshot = await adapter.getFulfillmentStatus({ externalOrderId: PS_ORDER_ID });

      expect(snapshot.trackingNumber).toBe('CARR-TRK-9');
      const orderCarriersCalls = (mockHttpClient.listResources as jest.Mock).mock.calls.filter(
        (call: unknown[]) => call[0] === 'order_carriers'
      );
      expect(orderCarriersCalls).toHaveLength(1);
    });

    it('should issue WS calls with the documented resource shapes', async () => {
      await adapter.getFulfillmentStatus({ externalOrderId: PS_ORDER_ID });

      expect(mockHttpClient.getResource).toHaveBeenCalledWith('orders', PS_ORDER_ID);
      expect(mockHttpClient.listResources).toHaveBeenCalledWith(
        'order_states',
        { custom: { deleted: '0' } },
        1000,
        0
      );
      // order_carriers is NOT called here — shipping_number was set on the order.
    });

    it('should swallow PrestashopResourceNotFoundException as `{status: null}` (order deleted in PS)', async () => {
      mockHttpClient.getResource = jest
        .fn()
        .mockRejectedValue(new PrestashopResourceNotFoundException('orders', PS_ORDER_ID));

      const snapshot = await adapter.getFulfillmentStatus({ externalOrderId: PS_ORDER_ID });

      expect(snapshot.status).toBeNull();
      expect(snapshot.trackingNumber).toBeNull();
      expect(snapshot.deliveredAt).toBeNull();
    });
  });
});
