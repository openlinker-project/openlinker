/**
 * Order Amendment Kind — vocabulary specs (#2305)
 *
 * @module libs/core/src/order-lifecycle/domain/types
 */
import {
  OrderAmendmentKindValues,
  isOrderAmendmentKind,
} from './order-amendment-kind.types';

describe('OrderAmendmentKind (#2305)', () => {
  it('should carry exactly the four design §6.2 kinds', () => {
    expect(OrderAmendmentKindValues).toEqual([
      'address-change',
      'line-quantity-change',
      'cancel-request',
      'delivery-method-change',
    ]);
  });

  describe('isOrderAmendmentKind', () => {
    it.each(OrderAmendmentKindValues)('should accept %s', (kind) => {
      expect(isOrderAmendmentKind(kind)).toBe(true);
    });

    it.each(['', 'cancel', 'address_change', 'quantity-change'])(
      'should reject the near-miss string %p',
      (value) => {
        expect(isOrderAmendmentKind(value)).toBe(false);
      },
    );

    it.each([undefined, null, 0, {}, []])(
      'should reject the non-string %p',
      (value) => {
        expect(isOrderAmendmentKind(value)).toBe(false);
      },
    );
  });
});
