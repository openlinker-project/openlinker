/**
 * OrderStatusWriteback capability guard — unit tests (#1158 / ADR-027)
 *
 * @module libs/core/src/orders/domain/ports/capabilities/__tests__
 */
import {
  type OrderStatusWriteback,
  isOrderStatusWriteback,
} from '../order-status-writeback.capability';

describe('isOrderStatusWriteback', () => {
  it('returns true when the adapter implements write', () => {
    const withCap: OrderStatusWriteback = { write: jest.fn() };
    expect(isOrderStatusWriteback(withCap)).toBe(true);
  });

  it('returns false when the adapter does not implement write', () => {
    expect(isOrderStatusWriteback({ createOrder: jest.fn() })).toBe(false);
  });

  it('is role-agnostic — narrows any object that exposes write', () => {
    const sourceLike = { listOrderFeed: jest.fn(), getOrder: jest.fn(), write: jest.fn() };
    expect(isOrderStatusWriteback(sourceLike)).toBe(true);
  });
});
