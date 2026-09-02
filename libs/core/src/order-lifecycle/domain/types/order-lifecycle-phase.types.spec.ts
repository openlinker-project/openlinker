/**
 * Order Lifecycle Phase — vocabulary + precedence specs (#2305)
 *
 * @module libs/core/src/order-lifecycle/domain/types
 */
import {
  ORDER_LIFECYCLE_PHASE_PRECEDENCE,
  OrderLifecyclePhaseValues,
  isOrderLifecyclePhase,
} from './order-lifecycle-phase.types';

describe('OrderLifecyclePhase (#2305)', () => {
  describe('OrderLifecyclePhaseValues', () => {
    it('should carry exactly the nine ADR-059 phases in precedence order', () => {
      expect(OrderLifecyclePhaseValues).toEqual([
        'cancelled',
        'vendor_authoritative',
        'delivered',
        'in_transit',
        'fulfillment_failed',
        'held',
        'amending',
        'blocked',
        'ready',
      ]);
    });

    it('should not contain the two deliberate absences', () => {
      const values = OrderLifecyclePhaseValues as readonly string[];
      expect(values).not.toContain('returned');
      expect(values.some((value) => value.startsWith('partially'))).toBe(false);
    });
  });

  describe('ORDER_LIFECYCLE_PHASE_PRECEDENCE', () => {
    it('should be a 1..9 bijection', () => {
      const ordinals = Object.values(ORDER_LIFECYCLE_PHASE_PRECEDENCE).sort(
        (a, b) => a - b,
      );

      expect(ordinals).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });

    it('should agree with the declaration order of the values array', () => {
      OrderLifecyclePhaseValues.forEach((phase, index) => {
        expect(ORDER_LIFECYCLE_PHASE_PRECEDENCE[phase]).toBe(index + 1);
      });
    });

    it('should rank a hold above an amendment (a decision outranks a request)', () => {
      expect(ORDER_LIFECYCLE_PHASE_PRECEDENCE.held).toBeLessThan(
        ORDER_LIFECYCLE_PHASE_PRECEDENCE.amending,
      );
    });

    it('should rank cancelled highest and ready lowest', () => {
      expect(ORDER_LIFECYCLE_PHASE_PRECEDENCE.cancelled).toBe(1);
      expect(ORDER_LIFECYCLE_PHASE_PRECEDENCE.ready).toBe(
        OrderLifecyclePhaseValues.length,
      );
    });
  });

  describe('isOrderLifecyclePhase', () => {
    it.each(OrderLifecyclePhaseValues)('should accept %s', (phase) => {
      expect(isOrderLifecyclePhase(phase)).toBe(true);
    });

    it.each([
      '',
      'returned',
      'partially_shipped',
      'Cancelled',
      'ready ',
    ])('should reject the near-miss string %p', (value) => {
      expect(isOrderLifecyclePhase(value)).toBe(false);
    });

    it.each([undefined, null, 0, 1, {}, [], true])(
      'should reject the non-string %p',
      (value) => {
        expect(isOrderLifecyclePhase(value)).toBe(false);
      },
    );
  });
});
