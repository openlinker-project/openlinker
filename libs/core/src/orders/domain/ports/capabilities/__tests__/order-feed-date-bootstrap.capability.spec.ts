/**
 * OrderFeedDateBootstrap capability guard tests (#4228)
 *
 * @module libs/core/src/orders/domain/ports/capabilities/__tests__
 */
import { isOrderFeedDateBootstrap } from '../order-feed-date-bootstrap.capability';

describe('isOrderFeedDateBootstrap', () => {
  it('should return true when cursorForDate is a function', () => {
    expect(isOrderFeedDateBootstrap({ cursorForDate: jest.fn() })).toBe(true);
  });

  it('should return false when cursorForDate is absent', () => {
    expect(isOrderFeedDateBootstrap({ headCursor: jest.fn() })).toBe(false);
  });

  it('should return false when cursorForDate is not a function', () => {
    expect(isOrderFeedDateBootstrap({ cursorForDate: 'x' })).toBe(false);
  });
});
