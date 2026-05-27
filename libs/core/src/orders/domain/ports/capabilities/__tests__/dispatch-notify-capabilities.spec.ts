/**
 * Dispatch-notify capability guards — unit tests (#837)
 *
 * @module libs/core/src/orders/domain/ports/capabilities/__tests__
 */
import type { OrderProcessorManagerPort } from '../../order-processor-manager.port';
import type { OrderSourcePort } from '../../order-source.port';
import {
  type OrderDispatchNotifier,
  isOrderDispatchNotifier,
} from '../order-dispatch-notifier.capability';
import {
  type OrderFulfillmentUpdater,
  isOrderFulfillmentUpdater,
} from '../order-fulfillment-updater.capability';

describe('isOrderDispatchNotifier', () => {
  const base: OrderSourcePort = { listOrderFeed: jest.fn(), getOrder: jest.fn() };

  it('returns true when the adapter implements notifyDispatched', () => {
    const withCap: OrderSourcePort & OrderDispatchNotifier = { ...base, notifyDispatched: jest.fn() };
    expect(isOrderDispatchNotifier(withCap)).toBe(true);
  });

  it('returns false when the adapter does not implement notifyDispatched', () => {
    expect(isOrderDispatchNotifier(base)).toBe(false);
  });
});

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
