/**
 * OrderWindowReader capability guard tests (#4228)
 *
 * @module libs/core/src/orders/domain/ports/capabilities/__tests__
 */
import { isOrderWindowReader } from '../order-window-reader.capability';

describe('isOrderWindowReader', () => {
  it('should return true when listOrdersInWindow is a function', () => {
    expect(isOrderWindowReader({ listOrdersInWindow: jest.fn() })).toBe(true);
  });

  it('should return false when listOrdersInWindow is absent', () => {
    expect(isOrderWindowReader({ cursorForDate: jest.fn() })).toBe(false);
  });

  it('should return false when listOrdersInWindow is not a function', () => {
    expect(isOrderWindowReader({ listOrdersInWindow: 'x' })).toBe(false);
  });
});
