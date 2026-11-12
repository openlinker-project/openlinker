import type { Connection, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import type { IMappingConfigService } from '@openlinker/core/mappings';
import {
  isDestinationOptionsReader,
  isOrderCreateStockEffect,
  isOrderFulfillmentUpdater,
  isOrderStatusWriteback,
  type OrderCreate,
} from '@openlinker/core/orders';

import { ShopifyNotSupportedException } from '../../../../domain/exceptions/shopify-not-supported.exception';
import { ShopifyUserErrorsException } from '../../../../domain/exceptions/shopify-user-errors.exception';
import type { ShopifyGraphqlClient } from '../../../http/shopify-graphql-client';
import type { ShopifyShopContextProvider } from '../../../shop-context/shopify-shop-context.provider';
import type { ShopifyOrderStatusWriteback } from '../../order-status/shopify-order-status-writeback';
import { ShopifyOrderProcessorAdapter } from '../shopify-order-processor.adapter';

const CONNECTION = { id: 'c1' } as Connection;
const LOCATION = 'gid://shopify/Location/1';

const ORDER: OrderCreate = {
  status: 'pending',
  internalOrderId: 'ol_order_1',
  items: [
    { id: 'l1', productId: 'p1', variantId: 'v1', quantity: 1, price: 50, name: 'Shirt' },
    { id: 'l2', productId: 'p2', variantId: 'v2', quantity: 1, price: 20, name: 'Cap' },
  ],
  totals: { subtotal: 70, tax: 0, shipping: 0, total: 70, currency: 'PLN' },
  shipping: { methodId: 'm1' },
  source: { connectionId: 'allegro-1' },
  sourcePaymentMethod: 'ONLINE',
  paymentStatus: 'paid',
};

interface Harness {
  readonly adapter: ShopifyOrderProcessorAdapter;
  readonly query: jest.Mock;
  readonly mutate: jest.Mock;
  readonly write: jest.Mock;
}

function build(
  options: {
    currency?: string;
    existing?: Array<{ id: string; name: string }>;
    mappingConfig?: IMappingConfigService;
    /** `inventoryItem.requiresShipping` of variant 9 (the one line that resolves). */
    variantShips?: boolean;
    /** Delivery-method names the store's delivery profiles offer. */
    deliveryMethods?: string[];
  } = {},
): Harness {
  // One mock for every read, answering by the operation the document names.
  const query = jest.fn((document: string) => {
    if (document.includes('OlVariantsRequireShipping')) {
      return Promise.resolve({
        nodes: [{ id: 'gid://shopify/ProductVariant/9', inventoryItem: { requiresShipping: options.variantShips ?? true } }],
      });
    }
    if (document.includes('OlDeliveryProfiles')) {
      const methods = (options.deliveryMethods ?? []).map((name, i) => ({ id: `m${i}`, name, active: true }));
      return Promise.resolve({
        deliveryProfiles: {
          nodes: [
            {
              name: 'General',
              profileLocationGroups: [
                { locationGroupZones: { nodes: [{ zone: { name: 'PL' }, methodDefinitions: { nodes: methods } }] } },
              ],
            },
          ],
        },
      });
    }
    if (document.includes('OlRecentOrderOptions')) {
      return Promise.resolve({ orders: { nodes: [] } });
    }
    return Promise.resolve({ orders: { nodes: options.existing ?? [] } });
  });
  const mutate = jest.fn();
  const write = jest.fn().mockResolvedValue({ outcome: 'applied' });
  const identifierMapping = {
    getExternalIds: jest.fn((_type: string, internalId: string) =>
      Promise.resolve(internalId === 'v1' ? [{ connectionId: 'c1', externalId: '9' }] : []),
    ),
  } as unknown as IdentifierMappingPort;
  const shopContext = {
    get: jest.fn().mockResolvedValue({ currencyCode: options.currency ?? 'PLN', locationGid: LOCATION }),
  } as unknown as ShopifyShopContextProvider;
  const adapter = new ShopifyOrderProcessorAdapter(
    { query, mutate } as unknown as ShopifyGraphqlClient,
    identifierMapping,
    shopContext,
    CONNECTION,
    { write } as unknown as ShopifyOrderStatusWriteback,
    options.mappingConfig,
  );
  return { adapter, query, mutate, write };
}

const created = (fulfillmentOrders: unknown[] = []): Record<string, unknown> => ({
  order: { id: 'gid://shopify/Order/77', name: '#1077', fulfillmentOrders: { nodes: fulfillmentOrders } },
});

describe('ShopifyOrderProcessorAdapter', () => {
  it('should declare the sub-capabilities core narrows it by', () => {
    const { adapter } = build();

    expect(isOrderStatusWriteback(adapter)).toBe(true);
    expect(isOrderFulfillmentUpdater(adapter)).toBe(true);
    expect(isDestinationOptionsReader(adapter)).toBe(true);
    expect(isOrderCreateStockEffect(adapter)).toBe(true);
  });

  it('should report that a create lowers the store stock', async () => {
    await expect(build().adapter.lowersStockOnOrderCreate()).resolves.toBe(true);
  });

  describe('createOrder', () => {
    it('should create the order with a variant line and a custom line and return its id and number', async () => {
      const h = build();
      h.mutate.mockResolvedValueOnce(created());

      await expect(h.adapter.createOrder(ORDER)).resolves.toEqual({ orderId: '77', orderNumber: '1077' });

      expect(h.query).toHaveBeenCalledWith(expect.any(String), { query: "source_identifier:'ol_order_1'" });
      const [, variables, mutation] = h.mutate.mock.calls[0] as [string, { order: { lineItems: unknown[] } }, string];
      expect(mutation).toBe('orderCreate');
      expect(variables.order.lineItems).toEqual([
        expect.objectContaining({ variantId: 'gid://shopify/ProductVariant/9', requiresShipping: true }),
        expect.objectContaining({ title: 'Cap', requiresShipping: true }),
      ]);
    });

    it('should mark a variant line as shipping or not from the variant itself (D1)', async () => {
      const h = build({ variantShips: false });
      h.mutate.mockResolvedValueOnce(created());

      await h.adapter.createOrder(ORDER);

      expect(h.query).toHaveBeenCalledWith(expect.stringContaining('OlVariantsRequireShipping'), {
        ids: ['gid://shopify/ProductVariant/9'],
      });
      const [, variables] = h.mutate.mock.calls[0] as [string, { order: { lineItems: unknown[] } }];
      expect(variables.order.lineItems[0]).toEqual(
        expect.objectContaining({ variantId: 'gid://shopify/ProductVariant/9', requiresShipping: false }),
      );
    });

    it('should return the order Shopify already holds instead of creating a second one', async () => {
      const h = build({ existing: [{ id: 'gid://shopify/Order/55', name: '#1055' }] });

      await expect(h.adapter.createOrder(ORDER)).resolves.toEqual({ orderId: '55', orderNumber: '1055' });

      expect(h.mutate).not.toHaveBeenCalled();
    });

    it('should refuse an order in another currency before anything is sent', async () => {
      const h = build({ currency: 'EUR' });

      await expect(h.adapter.createOrder(ORDER)).rejects.toBeInstanceOf(ShopifyNotSupportedException);

      expect(h.query).not.toHaveBeenCalled();
      expect(h.mutate).not.toHaveBeenCalled();
    });

    it('should move work Shopify routed elsewhere to the configured location', async () => {
      const h = build();
      h.mutate
        .mockResolvedValueOnce(
          created([
            { id: 'gid://shopify/FulfillmentOrder/1', status: 'OPEN', assignedLocation: { location: { id: 'gid://shopify/Location/2' } } },
            { id: 'gid://shopify/FulfillmentOrder/2', status: 'OPEN', assignedLocation: { location: { id: LOCATION } } },
          ]),
        )
        .mockResolvedValueOnce({});

      await h.adapter.createOrder(ORDER);

      expect(h.mutate).toHaveBeenCalledTimes(2);
      expect(h.mutate.mock.calls[1]).toEqual([
        expect.any(String),
        { id: 'gid://shopify/FulfillmentOrder/1', locationId: LOCATION },
        'fulfillmentOrderMove',
      ]);
    });

    it('should not fail the create when the move fails', async () => {
      const h = build();
      h.mutate
        .mockResolvedValueOnce(
          created([{ id: 'gid://shopify/FulfillmentOrder/1', status: 'OPEN', assignedLocation: { location: { id: 'x' } } }]),
        )
        .mockRejectedValueOnce(new Error('network'));

      await expect(h.adapter.createOrder(ORDER)).resolves.toEqual({ orderId: '77', orderNumber: '1077' });
    });

    it('should use the source connection mappings, and the source words when a lookup fails', async () => {
      const mappingConfig = {
        resolveCarrierMapping: jest.fn().mockResolvedValue('Standard'),
        resolvePaymentMapping: jest.fn().mockRejectedValue(new Error('db down')),
      } as unknown as IMappingConfigService;
      const h = build({ mappingConfig, deliveryMethods: ['Standard'] });
      h.mutate.mockResolvedValueOnce(created());

      await h.adapter.createOrder(ORDER);

      expect(mappingConfig.resolveCarrierMapping).toHaveBeenCalledWith('allegro-1', 'm1');
      expect(mappingConfig.resolvePaymentMapping).toHaveBeenCalledWith('allegro-1', 'ONLINE');
      const [, variables] = h.mutate.mock.calls[0] as [string, { order: Record<string, unknown> }];
      expect(variables.order.shippingLines).toEqual([expect.objectContaining({ title: 'Standard', code: 'Standard' })]);
      expect(variables.order.transactions).toEqual([expect.objectContaining({ gateway: 'manual' })]);
    });

    it('should ignore a mapped value that is not one of this store own (mapped for another destination, D5)', async () => {
      const mappingConfig = {
        resolveCarrierMapping: jest.fn().mockResolvedValue('1'),
        resolvePaymentMapping: jest.fn().mockResolvedValue('ps_wirepayment'),
      } as unknown as IMappingConfigService;
      const h = build({ mappingConfig, deliveryMethods: ['Standard'] });
      h.mutate.mockResolvedValueOnce(created());

      await h.adapter.createOrder(ORDER);

      const [, variables] = h.mutate.mock.calls[0] as [string, { order: Record<string, unknown> }];
      expect(variables.order.shippingLines).toEqual([expect.objectContaining({ title: 'm1', code: 'm1' })]);
      expect(variables.order.transactions).toEqual([expect.objectContaining({ gateway: 'manual' })]);
    });

    it('should throw when Shopify returns no order', async () => {
      const h = build();
      h.mutate.mockResolvedValueOnce({ order: null });

      await expect(h.adapter.createOrder(ORDER)).rejects.toBeInstanceOf(ShopifyUserErrorsException);
    });
  });

  describe('updateFulfillment', () => {
    it('should fulfil a shipped order with its tracking number through the writeback', async () => {
      const h = build();

      await h.adapter.updateFulfillment({ externalOrderId: '77', status: 'shipped', trackingNumber: 'TRK1' });

      expect(h.write).toHaveBeenCalledWith({ type: 'dispatched', externalOrderId: '77', trackingNumber: 'TRK1' });
    });

    it('should cancel a cancelled order', async () => {
      const h = build();

      await h.adapter.updateFulfillment({ externalOrderId: '77', status: 'cancelled' });

      expect(h.write).toHaveBeenCalledWith({ type: 'cancelled', externalOrderId: '77' });
    });

    it('should do nothing for a status Shopify has no counterpart for', async () => {
      const h = build();

      await h.adapter.updateFulfillment({ externalOrderId: '77', status: 'processing' });

      expect(h.write).not.toHaveBeenCalled();
    });

    it('should throw when Shopify refuses', async () => {
      const h = build();
      h.write.mockResolvedValueOnce({ outcome: 'rejected', detail: 'no open fulfillment order' });

      await expect(
        h.adapter.updateFulfillment({ externalOrderId: '77', status: 'shipped' }),
      ).rejects.toBeInstanceOf(ShopifyUserErrorsException);
    });
  });
});
