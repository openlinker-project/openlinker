/**
 * Hold Reason — vocabulary specs (#2305)
 *
 * @module libs/core/src/order-lifecycle/domain/types
 */
import { HoldReasonValues, isHoldReason } from './hold-reason.types';

describe('HoldReason (#2305)', () => {
  it('should carry exactly the eight merged reasons from design adjudication #4', () => {
    expect(HoldReasonValues).toEqual([
      'payment-review',
      'fraud-review',
      'operator',
      'stock-shortfall',
      'address-invalid',
      'awaiting-amendment',
      'awaiting-customer-confirmation',
      'external',
    ]);
  });

  it('should have no duplicate values', () => {
    expect(new Set(HoldReasonValues).size).toBe(HoldReasonValues.length);
  });

  describe('isHoldReason', () => {
    it.each(HoldReasonValues)('should accept %s', (reason) => {
      expect(isHoldReason(reason)).toBe(true);
    });

    /**
     * `operator_forced` is REVIEW H14's named drift — the snake_case dialect the
     * merged union deliberately does not speak. Pinning it keeps a future edit
     * from quietly reintroducing a second spelling.
     */
    it.each(['operator_forced', 'payment_review', '', 'External'])(
      'should reject the drifted spelling %p',
      (value) => {
        expect(isHoldReason(value)).toBe(false);
      },
    );

    it.each([undefined, null, 0, {}, [], true])(
      'should reject the non-string %p',
      (value) => {
        expect(isHoldReason(value)).toBe(false);
      },
    );
  });
});
