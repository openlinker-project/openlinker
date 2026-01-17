/**
 * Mock Allegro Adapter Helpers
 *
 * Utilities for creating mock Allegro marketplace adapters for integration tests.
 * These mocks return test data without making real API calls.
 *
 * @module apps/worker/test/integration/helpers
 */
import { MarketplacePort, MarketplaceOrderFeedOutput } from '@openlinker/core/integrations';
import { IncomingOrder } from '@openlinker/core/orders';

/**
 * Create a mock Allegro Marketplace adapter
 *
 * Returns test order data without making real API calls.
 */
export function createMockAllegroMarketplaceAdapter(): MarketplacePort {
  let cursor = 'initial-cursor';
  const orders: Map<string, IncomingOrder> = new Map();

  // Create a test order
  const testOrder: IncomingOrder = {
    externalOrderId: 'checkout-form-001',
    orderNumber: 'ALLEGRO-ORDER-001',
    status: 'pending',
    customerExternalId: 'buyer-001',
    items: [
      {
        id: 'item-1',
        productRef: { type: 'offer', externalId: 'offer-1' },
        quantity: 2,
        price: 19.99,
        sku: 'SKU-1',
      },
    ],
    totals: {
      subtotal: 39.98,
      shipping: 5.0,
      tax: 0.0,
      total: 44.98,
      currency: 'PLN',
    },
    shippingAddress: {
      address1: 'Test Street 123',
      city: 'Warsaw',
      postalCode: '00-001',
      country: 'PL',
    },
    billingAddress: {
      address1: 'Test Street 123',
      city: 'Warsaw',
      postalCode: '00-001',
      country: 'PL',
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: {
      sourceEventId: 'event-001',
      sourceCheckoutFormId: 'checkout-form-001',
    },
  };

  orders.set('checkout-form-001', testOrder);

  return {
    listOrderFeed: jest.fn().mockImplementation(async (input): Promise<MarketplaceOrderFeedOutput> => {
      const limit = input.limit;
      void input.fromCursor;

      const items: MarketplaceOrderFeedOutput['items'] = [
        {
          externalOrderId: 'checkout-form-001',
          eventType: 'updated' as const,
          occurredAt: '2024-01-01T00:00:00Z',
          eventKey: 'event-001',
          eventId: 'event-001',
        },
        {
          externalOrderId: 'checkout-form-002',
          eventType: 'updated' as const,
          occurredAt: '2024-01-01T01:00:00Z',
          eventKey: 'event-002',
          eventId: 'event-002',
        },
      ].slice(0, limit);

      cursor = `cursor-${Date.now()}`;

      return {
        items,
        nextCursor: cursor,
      };
    }),

    getOrder: jest.fn().mockImplementation(async ({ externalOrderId }): Promise<IncomingOrder> => {
      const order = orders.get(externalOrderId);
      if (order) return order;

      return {
        externalOrderId,
        orderNumber: `ALLEGRO-ORDER-${externalOrderId}`,
        status: 'pending',
        customerExternalId: `buyer-${externalOrderId}`,
        items: [
          {
            id: 'item-1',
            productRef: { type: 'offer', externalId: 'offer-2' },
            quantity: 1,
            price: 29.99,
            sku: 'SKU-2',
          },
        ],
        totals: {
          subtotal: 29.99,
          shipping: 5.0,
          tax: 0.0,
          total: 34.99,
          currency: 'PLN',
        },
        shippingAddress: {
          address1: 'Test Street 456',
          city: 'Krakow',
          postalCode: '30-001',
          country: 'PL',
        },
        billingAddress: {
          address1: 'Test Street 456',
          city: 'Krakow',
          postalCode: '30-001',
          country: 'PL',
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: {
          sourceEventId: `event-${externalOrderId}`,
        },
      };
    }),

    updateOfferQuantity: jest.fn().mockResolvedValue(undefined),
  } as unknown as MarketplacePort;
}


