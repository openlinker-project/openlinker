/**
 * Order fulfillment-updater capability guard — unit tests (#858)
 *
 * (The former `OrderDispatchNotifier` guard was retired in #1168 — its
 * source-side dispatch role folded into `OrderStatusWriteback`.)
 *
 * @module libs/core/src/orders/domain/ports/capabilities/__tests__
 */
import type { OrderProcessorManagerPort } from '../../order-processor-manager.port';
import {
  type OrderFulfillmentUpdater,
  isOrderFulfillmentUpdater,
} from '../order-fulfillment-updater.capability';

describe('isOrderFulfillmentUpdater', () => {
  const base: OrderProcessorManagerPort = { createOrder: jest.fn() };

  it('returns true when the adapter implements updateFulfillment', () => {
    const withCap: OrderProcessorManagerPort & OrderFulfillmentUpdater = {
      ...base,
      updateFulfillment: jest.fn(),
    };
    expect(isOrderFulfillmentUpdater(withCap)).toBe(true);
  });

  it('returns false when the adapter does not implement updateFulfillment', () => {
    expect(isOrderFulfillmentUpdater(base)).toBe(false);
  });
});
