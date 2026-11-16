/**
 * Payment status types - unit tests
 *
 * @module libs/core/src/orders/domain/types
 */
import { isRoutingAwaitingPayment } from './payment-status.types';

describe('isRoutingAwaitingPayment (#4033)', () => {
  it('should wait for an order whose payment is not completed', () => {
    expect(isRoutingAwaitingPayment('awaiting')).toBe(true);
  });

  it('should wait for a refunded order', () => {
    expect(isRoutingAwaitingPayment('refunded')).toBe(true);
  });

  it('should route a paid order', () => {
    expect(isRoutingAwaitingPayment('paid')).toBe(false);
  });

  it('should route a cash on delivery order before it is paid', () => {
    expect(isRoutingAwaitingPayment('cod')).toBe(false);
  });

  it('should route an order whose source does not report payment', () => {
    expect(isRoutingAwaitingPayment(undefined)).toBe(false);
  });
});
