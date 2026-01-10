/**
 * Mock Allegro Adapter Helpers
 *
 * Utilities for creating mock Allegro adapters for integration tests.
 * These mocks return test data without making real API calls.
 *
 * @module apps/worker/test/integration/helpers
 */
import { MarketplaceIntegrationPort, MarketplaceOrderFeedResponse, UpdateOfferQuantityResult } from '@openlinker/core/listings';
import { Order } from '@openlinker/core/orders';
import { randomUUID } from 'crypto';

/**
 * Create a mock Allegro Marketplace adapter
 *
 * Returns test order data without making real API calls.
 */
export function createMockAllegroMarketplaceAdapter(): MarketplaceIntegrationPort {
  let cursor = 'initial-cursor';
  const orders: Map<string, Order> = new Map();

  // Create a test order
  const testOrder: Order = {
    id: randomUUID(),
    orderNumber: 'ALLEGRO-ORDER-001',
    status: 'pending',
    customerId: randomUUID(),
    items: [
      {
        productId: randomUUID(),
        quantity: 2,
        price: 19.99,
        name: 'Test Product',
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
      street: 'Test Street 123',
      city: 'Warsaw',
      postalCode: '00-001',
      country: 'PL',
    },
    billingAddress: {
      street: 'Test Street 123',
      city: 'Warsaw',
      postalCode: '00-001',
      country: 'PL',
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    metadata: {
      sourceEventId: 'event-001',
      sourceCheckoutFormId: 'checkout-form-001',
    },
  };

  orders.set('checkout-form-001', testOrder);

  return {
    getOrders: jest.fn().mockImplementation(async (params: { cursor?: string; limit?: number }): Promise<MarketplaceOrderFeedResponse> => {
      const limit = params.limit || 10;
      const currentCursor = params.cursor || cursor;

      // Simulate pagination: return orders and advance cursor
      const items = [
        {
          eventId: 'event-001',
          checkoutFormId: 'checkout-form-001',
        },
        {
          eventId: 'event-002',
          checkoutFormId: 'checkout-form-002',
        },
      ].slice(0, limit);

      // Advance cursor
      cursor = `cursor-${Date.now()}`;

      return {
        items,
        nextCursor: cursor,
      };
    }),

    getOrderByCheckoutFormId: jest.fn().mockImplementation(async (checkoutFormId: string): Promise<Order> => {
      const order = orders.get(checkoutFormId);
      if (!order) {
        // Create a new order for unknown checkout form IDs
        return {
          id: randomUUID(),
          orderNumber: `ALLEGRO-ORDER-${checkoutFormId}`,
          status: 'pending',
          customerId: randomUUID(),
          items: [
            {
              productId: randomUUID(),
              quantity: 1,
              price: 29.99,
              name: 'Test Product 2',
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
            street: 'Test Street 456',
            city: 'Krakow',
            postalCode: '30-001',
            country: 'PL',
          },
          billingAddress: {
            street: 'Test Street 456',
            city: 'Krakow',
            postalCode: '30-001',
            country: 'PL',
          },
          createdAt: new Date(),
          updatedAt: new Date(),
          metadata: {
            sourceEventId: `event-${checkoutFormId}`,
            sourceCheckoutFormId: checkoutFormId,
          },
        };
      }
      return order;
    }),

    updateOfferQuantity: jest.fn().mockImplementation(async (request: { offerId: string; quantity: number; idempotencyKey: string }): Promise<UpdateOfferQuantityResult> => {
      // Generate deterministic command ID from idempotency key
      const commandId = randomUUID();
      return {
        commandId,
        status: 'queued' as const,
      };
    }),
  } as unknown as MarketplaceIntegrationPort;
}


