/**
 * phaseToOrderStatus — totality + projection specs (#2305)
 *
 * The AC is TOTALITY: every one of the nine phases must project onto a real
 * member of the transport vocabulary. The `Record` annotation enforces this at
 * compile time; this spec enforces it at runtime too, so that a mapping built
 * from a widened union (or a hand-edited object literal) cannot hand
 * `undefined` to a writeback adapter.
 *
 * The runtime import of `OrderStatusValues` from the orders types sub-barrel is
 * the reason that array is exported: a spec may take a value edge the leaf
 * itself may not (specs are walker-exempt).
 *
 * @module libs/core/src/order-lifecycle/domain/domain-services
 */
import { OrderStatusValues } from '@openlinker/core/orders/types';

import { OrderLifecyclePhaseValues } from '../types/order-lifecycle-phase.types';
import { phaseToOrderStatus } from './phase-to-order-status';

describe('phaseToOrderStatus (#2305)', () => {
  it('should be total over every lifecycle phase', () => {
    OrderLifecyclePhaseValues.forEach((phase) => {
      const status = phaseToOrderStatus(phase);

      expect(status).toBeDefined();
      expect(OrderStatusValues as readonly string[]).toContain(status);
    });
  });

  it('should cover exactly the nine phases and no more', () => {
    const mapped = new Set(
      OrderLifecyclePhaseValues.map((phase) => phaseToOrderStatus(phase)),
    );

    expect(OrderLifecyclePhaseValues).toHaveLength(9);
    // The projection is lossy by design — nine phases onto a six-value
    // transport vocabulary — so the distinct targets must be FEWER.
    expect(mapped.size).toBeLessThan(OrderLifecyclePhaseValues.length);
  });

  describe('the projection table (reviewer-visible)', () => {
    it.each([
      ['cancelled', 'cancelled'],
      ['vendor_authoritative', 'processing'],
      ['delivered', 'delivered'],
      ['in_transit', 'shipped'],
      ['fulfillment_failed', 'processing'],
      ['held', 'processing'],
      ['amending', 'processing'],
      ['blocked', 'processing'],
      ['ready', 'pending'],
    ] as const)('should project %s onto %s', (phase, expected) => {
      expect(phaseToOrderStatus(phase)).toBe(expected);
    });
  });

  it('should never project onto refunded (no phase asserts a financial event)', () => {
    const mapped = OrderLifecyclePhaseValues.map((phase) =>
      phaseToOrderStatus(phase),
    );

    expect(mapped).not.toContain('refunded');
  });

  it('should be pure — repeated calls agree', () => {
    OrderLifecyclePhaseValues.forEach((phase) => {
      expect(phaseToOrderStatus(phase)).toBe(phaseToOrderStatus(phase));
    });
  });
});
