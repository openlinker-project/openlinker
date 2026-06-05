/**
 * PrestaShop Order Processor Manager — createOrder
 *
 * Unit tests for the order-creation path (customer/product/variant id
 * resolution, cart + validateOrder import, source-authoritative line pricing,
 * synthetic-variant coercion, error wrapping). Split from the former 2279-line
 * adapter spec (#976); shared mocks/adapter/builders live in the sibling
 * factory at src/__tests__/mocks.
 *
 * @module libs/integrations/prestashop/src/infrastructure/adapters/__tests__
 */
import {
  createOrderProcessorManagerHarness,
  createTestOrder,
  OL_DYNAMIC_CARRIER_ID,
  IMPORT_ORDER_STATE_ID,
  type OrderProcessorHarness,
} from '../../../__tests__/mocks/prestashop-order-processor-manager.factory';
import { PrestashopApiException } from '@openlinker/integrations-prestashop';
import type { OrderCreate } from '@openlinker/core/orders';
import type { PrestashopOrder } from '../../mappers/prestashop.mapper.interface';

describe('PrestashopOrderProcessorManagerAdapter — createOrder', () => {
  let adapter: OrderProcessorHarness['adapter'];
  let mockHttpClient: OrderProcessorHarness['mockHttpClient'];
  let mockIdentifierMapping: OrderProcessorHarness['mockIdentifierMapping'];
  let mockOrderMapper: OrderProcessorHarness['mockOrderMapper'];
  let mockTaxRateResolver: OrderProcessorHarness['mockTaxRateResolver'];
  let mockCustomerProjectionRepository: OrderProcessorHarness['mockCustomerProjectionRepository'];
  let mockOpenLinkerModuleClient: OrderProcessorHarness['mockOpenLinkerModuleClient'];
  let connection: OrderProcessorHarness['connection'];
  let setCreateResourceDispatch: OrderProcessorHarness['setCreateResourceDispatch'];

  beforeEach(() => {
    ({
      adapter,
      mockHttpClient,
      mockIdentifierMapping,
      mockOrderMapper,
      mockTaxRateResolver,
      mockCustomerProjectionRepository,
      mockOpenLinkerModuleClient,
      connection,
      setCreateResourceDispatch,
    } = createOrderProcessorManagerHarness());
  });

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
      expect(mockHttpClient.createResource).toHaveBeenCalledWith('carts', expect.any(Object));
      // Order INSERT is the OL module's validateOrder import (ADR-016 / #905),
      // NOT the raw WS POST /orders. cart id '123' → idCart 123; the mapped
      // order-state, authoritative total, and order reference flow through.
      expect(mockOpenLinkerModuleClient.importOrder).toHaveBeenCalledWith({
        idCart: 123,
        idOrderState: IMPORT_ORDER_STATE_ID,
        amountPaid: order.totals.total,
        paymentMethod: 'Check payment',
        orderReference: order.orderNumber,
      });
      // #909: the adapter no longer writes the order mapping — OrderSyncService owns it.
      expect(mockIdentifierMapping.createMapping).not.toHaveBeenCalled();
      // Returns the destination-native PS order id (#909), not the internal id.
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

      // Mock cart + specific_prices to succeed; the order INSERT
      // (importOrder / validateOrder) fails.
      const createdCart = { id: '123' };
      mockHttpClient.createResource = jest.fn().mockImplementation((resource: string) => {
        if (resource === 'carts') {
          return Promise.resolve(createdCart);
        }
        if (resource === 'specific_prices') {
          return Promise.resolve({ id: 'sp_test' });
        }
        return Promise.reject(new Error(`Unexpected resource: ${resource}`));
      });
      // The OL module import fails — a plain Error is wrapped by the outer
      // catch into PrestashopApiException ("Failed to create PrestaShop order").
      mockOpenLinkerModuleClient.importOrder = jest
        .fn()
        .mockRejectedValue(new Error('Order creation failed'));

      await expect(adapter.createOrder(order)).rejects.toThrow(PrestashopApiException);
      await expect(adapter.createOrder(order)).rejects.toThrow('Failed to create PrestaShop order');
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
      setCreateResourceDispatch({ id: '999' }, createdOrder);
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

        // specific_prices must be written BEFORE the order INSERT
        // (importOrder / validateOrder). Compare global invocation order:
        // the last specific_prices createResource call must precede importOrder.
        const lastSpecificOrder = (mockHttpClient.createResource as jest.Mock).mock.invocationCallOrder
          .filter((_v, i) => createCalls()[i][0] === 'specific_prices')
          .at(-1) as number;
        const importOrderInvocation = (mockOpenLinkerModuleClient.importOrder as jest.Mock).mock
          .invocationCallOrder[0];
        expect(lastSpecificOrder).toBeLessThan(importOrderInvocation);

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

    describe('synthetic-variant id coercion in pinLinePrices (#923)', () => {
      type CreateCall = [string, Record<string, unknown>];
      const createCalls = (): CreateCall[] =>
        (mockHttpClient.createResource as jest.Mock).mock.calls as CreateCall[];
      const specificPriceFor = (productId: string): Record<string, unknown> | undefined =>
        createCalls()
          .filter((c) => c[0] === 'specific_prices')
          .find((c) => c[1].id_product === productId)?.[1];

      // Resolve a single-line order whose one line carries `variantExternalId`
      // as the ProductVariant external id (Product → '100'). Drives the
      // `id_product_attribute` the pin path sends to PrestaShop.
      const arrangeSingleLine = (variantExternalId: string): void => {
        mockIdentifierMapping.getExternalIds = jest
          .fn()
          .mockImplementation((entityType: string, internalId: string) => {
            if (entityType === 'Order') return Promise.resolve([]);
            const map: Record<string, Record<string, string>> = {
              Customer: { 'internal-customer-123': '42' },
              Product: { 'internal-product-456': '100' },
              ProductVariant: { 'internal-variant-789': variantExternalId },
            };
            const externalId = map[entityType]?.[internalId];
            return Promise.resolve(
              externalId ? [{ connectionId: connection.id, externalId, entityType }] : []
            );
          });
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

      const singleLineOrder = (): OrderCreate =>
        createTestOrder({
          items: [
            {
              id: 'item-1',
              productId: 'internal-product-456',
              variantId: 'internal-variant-789',
              quantity: 1,
              price: 29.99,
              sku: 'PROD-001-VAR-001',
            },
          ],
          totals: {
            subtotal: 29.99,
            tax: 0,
            shipping: 5.0,
            total: 34.99,
            currency: 'EUR',
            taxTreatment: 'inclusive',
          },
        });

      it('should pin id_product_attribute=0 when the variant is a synthetic marker (product:<n>)', async () => {
        // Simple products map to a synthetic-variant marker, not a numeric
        // combination id. PrestaShop 400-rejects a non-numeric
        // id_product_attribute, so it must collapse to 0 ("no combination").
        arrangeSingleLine('product:25');

        await adapter.createOrder(singleLineOrder());

        expect(specificPriceFor('100')?.id_product_attribute).toBe(0);
      });

      it('should pin the numeric combination id when the variant maps to a real PS combination', async () => {
        arrangeSingleLine('300');

        await adapter.createOrder(singleLineOrder());

        expect(specificPriceFor('100')?.id_product_attribute).toBe(300);
      });

      it('should surface the upstream PrestaShop responseBody in the pin-failure error', async () => {
        // The real validation reason lives in PrestashopApiException.responseBody,
        // not message — the thrown error must carry it so the failure is
        // diagnosable (the original #923 symptom was an opaque "400" with no body).
        arrangeSingleLine('product:25');
        const psErrorBody =
          '<errors><error><message>Property SpecificPrice->id_product_attribute is not valid</message></error></errors>';
        mockHttpClient.createResource = jest.fn().mockImplementation((resource: string) => {
          if (resource === 'specific_prices') {
            return Promise.reject(
              new PrestashopApiException(
                'PrestaShop API error (400): /api/specific_prices',
                400,
                psErrorBody
              )
            );
          }
          return Promise.resolve({ id: '123' });
        });

        await expect(adapter.createOrder(singleLineOrder())).rejects.toThrow(
          /Property SpecificPrice->id_product_attribute is not valid/
        );
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

    describe('validateOrder import path (ADR-016 / #905)', () => {
      // Wires customer/product/variant id resolution for a clean create path.
      // `orderExternalIds` overrides the Step-0 'Order' lookup so a test can
      // exercise the identifier-mapping idempotency guard.
      const wireResolution = (
        orderExternalIds: Array<{ connectionId: string; externalId: string; entityType: string }> = []
      ): void => {
        mockIdentifierMapping.getExternalIds = jest
          .fn()
          .mockImplementation((entityType: string, internalId: string) => {
            if (entityType === 'Order') return Promise.resolve(orderExternalIds);
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
        mockIdentifierMapping.createMapping = jest.fn().mockResolvedValue(undefined);
      };

      it('should call importOrder with the resolved cart id, mapped order-state, authoritative total and reference', async () => {
        const order = createTestOrder();
        wireResolution();
        setCreateResourceDispatch({ id: '123' }, {
          id: '999',
          reference: order.orderNumber,
        } as PrestashopOrder);

        await adapter.createOrder(order);

        expect(mockOpenLinkerModuleClient.importOrder).toHaveBeenCalledWith({
          idCart: 123,
          idOrderState: IMPORT_ORDER_STATE_ID,
          amountPaid: order.totals.total,
          paymentMethod: 'Check payment',
          orderReference: order.orderNumber,
        });
      });

      it('should reuse an existing PrestaShop order found by reference without calling importOrder', async () => {
        // No Step-0 mapping (orderExternalIds empty) but orderNumber is set, so
        // the reference dedup net fires: listResources('orders', …) returns a
        // pre-existing row and importOrder must be skipped.
        const order = createTestOrder();
        wireResolution();
        setCreateResourceDispatch({ id: '123' }, {
          id: '999',
          reference: order.orderNumber,
        } as PrestashopOrder);
        mockHttpClient.listResources = jest
          .fn()
          .mockImplementation((resource: string, params?: { custom?: Record<string, unknown> }) => {
            if (resource === 'carriers' && params?.custom?.external_module_name === 'openlinker') {
              return Promise.resolve([{ id: OL_DYNAMIC_CARRIER_ID, active: '1', deleted: '0' }]);
            }
            if (resource === 'orders') {
              return Promise.resolve([{ id: '777', reference: 'TEST-ORDER-001' }]);
            }
            return Promise.resolve([]);
          });

        const result = await adapter.createOrder(order);

        expect(mockOpenLinkerModuleClient.importOrder).not.toHaveBeenCalled();
        // #909: the reused order's destination-native id (777) is returned; the
        // external↔internal mapping write is OrderSyncService's, not the adapter's.
        expect(result.orderId).toBe('777');
        expect(result.orderNumber).toBe('TEST-ORDER-001');
        expect(mockIdentifierMapping.createMapping).not.toHaveBeenCalled();
      });

      it('should propagate an importOrder failure as PrestashopApiException', async () => {
        const order = createTestOrder();
        wireResolution();
        setCreateResourceDispatch({ id: '123' }, {
          id: '999',
          reference: order.orderNumber,
        } as PrestashopOrder);
        mockOpenLinkerModuleClient.importOrder = jest
          .fn()
          .mockRejectedValueOnce(new Error('boom'));

        await expect(adapter.createOrder(order)).rejects.toThrow(PrestashopApiException);
      });

      it('should handle alreadyExisted=true from importOrder', async () => {
        const order = createTestOrder();
        wireResolution();
        setCreateResourceDispatch({ id: '123' }, {
          id: '999',
          reference: order.orderNumber,
        } as PrestashopOrder);
        mockOpenLinkerModuleClient.importOrder = jest
          .fn()
          .mockResolvedValue({ idOrder: 555, reference: 'R-555', alreadyExisted: true });

        const result = await adapter.createOrder(order);

        // #909: external id 555 is returned; no adapter-side mapping write.
        expect(result.orderId).toBe('555');
        expect(result.orderNumber).toBe('R-555');
        expect(mockIdentifierMapping.createMapping).not.toHaveBeenCalled();
      });

      it('should warn on order-total reconciliation drift', async () => {
        // subtotal(100) + shipping(5) = 105 ≠ total(90) → drift > 0.01.
        const order = createTestOrder({
          totals: { subtotal: 100, tax: 0, shipping: 5, total: 90, currency: 'EUR' },
        });
        wireResolution();
        setCreateResourceDispatch({ id: '123' }, {
          id: '999',
          reference: order.orderNumber,
        } as PrestashopOrder);
        const warnSpy = jest
          .spyOn((adapter as unknown as { logger: { warn: jest.Mock } }).logger, 'warn')
          .mockImplementation(() => undefined);

        await adapter.createOrder(order);

        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('reconciliation drift')
        );
        warnSpy.mockRestore();
      });

      it("should warn when orderNumber is absent (dedup net disabled) and still import with empty reference", async () => {
        const order = createTestOrder({ orderNumber: undefined });
        wireResolution();
        setCreateResourceDispatch({ id: '123' }, {
          id: '999',
          reference: 'PS-ORDER-999',
        } as PrestashopOrder);
        const warnSpy = jest
          .spyOn((adapter as unknown as { logger: { warn: jest.Mock } }).logger, 'warn')
          .mockImplementation(() => undefined);

        await adapter.createOrder(order);

        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringContaining('reference-based duplicate recovery is unavailable')
        );
        expect(mockOpenLinkerModuleClient.importOrder).toHaveBeenCalledWith(
          expect.objectContaining({ orderReference: '' })
        );
        warnSpy.mockRestore();
      });
    });
  });
});
