/**
 * OrderFeedBootstrap capability guard tests (#4228)
 *
 * @module libs/core/src/orders/domain/ports/capabilities/__tests__
 */
import { isOrderFeedBootstrap } from '../order-feed-bootstrap.capability';

describe('isOrderFeedBootstrap', () => {
  it('should return true when headCursor is a function', () => {
    expect(isOrderFeedBootstrap({ headCursor: jest.fn() })).toBe(true);
  });

  it('should return false when headCursor is absent', () => {
    expect(isOrderFeedBootstrap({ listOrderFeed: jest.fn() })).toBe(false);
  });

  it('should return false when headCursor is not a function', () => {
    expect(isOrderFeedBootstrap({ headCursor: 'x' })).toBe(false);
  });
});
