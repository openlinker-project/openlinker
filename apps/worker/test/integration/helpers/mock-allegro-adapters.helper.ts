/**
 * Mock Allegro Adapter Helpers
 *
 * Utilities for creating mock Allegro adapters for integration tests. Post-#328,
 * the legacy `MarketplacePort` is split into `OrderSourcePort` (order feed +
 * hydration) and `OfferManagerPort` (offer CRUD + quantity/field updates);
 * this helper exposes one factory per capability.
 *
 * @module apps/worker/test/integration/helpers
 */
import type { OrderSourcePort, OrderFeedOutput, IncomingOrder } from '@openlinker/core/orders';
import type { OfferManagerPort } from '@openlinker/core/listings';

/**
 * Build a canonical test `IncomingOrder` used by both factories.
 */
function buildTestOrder(externalOrderId: string = 'checkout-form-001'): IncomingOrder {
  return {
    externalOrderId,
    orderNumber: `ALLEGRO-ORDER-${externalOrderId}`,
    status: 'pending',
    customerExternalId: `buyer-${externalOrderId}`,
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
      sourceEventId: `event-${externalOrderId}`,
      sourceCheckoutFormId: externalOrderId,
    },
  };
}

/**
 * Create a mock Allegro `OrderSourcePort` adapter.
 *
 * Returns two deterministic events from `listOrderFeed` and a synthetic
 * `IncomingOrder` from `getOrder`. Suitable for order-poll / order-sync
 * integration-test scenarios.
 */
export function createMockAllegroOrderSource(): OrderSourcePort {
  const seedOrder = buildTestOrder('checkout-form-001');
  const orders = new Map<string, IncomingOrder>([[seedOrder.externalOrderId, seedOrder]]);
  let cursor = 'initial-cursor';

  return {
    listOrderFeed: jest.fn().mockImplementation(async (input): Promise<OrderFeedOutput> => {
      const limit = input.limit;
      void input.fromCursor;

      const items: OrderFeedOutput['items'] = [
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
      return { items, nextCursor: cursor };
    }),

    getOrder: jest.fn().mockImplementation(async ({ externalOrderId }): Promise<IncomingOrder> => {
      const existing = orders.get(externalOrderId);
      if (existing) return existing;
      return buildTestOrder(externalOrderId);
    }),
  };
}

/**
 * Create a mock Allegro `OfferManagerPort` adapter.
 *
 * Only wires the methods required by the existing integration specs
 * (`updateOfferQuantity`). Additional methods are left unset and adapters can
 * extend the returned object per test when they need them.
 */
export function createMockAllegroOfferManager(): OfferManagerPort {
  return {
    updateOfferQuantity: jest.fn().mockResolvedValue(undefined),
  };
}

/**
 * @deprecated Legacy combined helper. Kept as a thin compatibility shim so the
 * in-tree integration specs continue to compile during the #328 split window.
 * New tests should call `createMockAllegroOrderSource` / `createMockAllegroOfferManager`
 * directly.
 */
export function createMockAllegroMarketplaceAdapter(): OrderSourcePort & OfferManagerPort {
  return {
    ...createMockAllegroOrderSource(),
    ...createMockAllegroOfferManager(),
  };
}
