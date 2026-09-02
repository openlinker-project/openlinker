/**
 * OrderHold entity — pure-derivation spec (#2338)
 *
 * @module libs/core/src/orders/domain/entities
 */
import { OrderHold } from './order-hold.entity';

const buildHold = (releasedAt: Date | null): OrderHold =>
  new OrderHold(
    'hold-1',
    'ol_order_aaa',
    'fraud-review',
    'looks off',
    'user-1',
    null,
    new Date('2026-08-01T10:00:00.000Z'),
    releasedAt,
    releasedAt ? 'user-2' : null,
    releasedAt ? 'cleared' : null,
    new Date('2026-08-01T10:00:00.000Z'),
    new Date('2026-08-01T10:00:00.000Z')
  );

describe('OrderHold (#2338)', () => {
  describe('isOpen', () => {
    it('should report open when releasedAt is null', () => {
      expect(buildHold(null).isOpen()).toBe(true);
    });

    it('should report not open when releasedAt is stamped', () => {
      expect(buildHold(new Date('2026-08-02T10:00:00.000Z')).isOpen()).toBe(
        false
      );
    });

    it('should read only its own field, so the same instance is stable over time', () => {
      // The derivation takes no clock and no parameters (ADR-011). Asserted
      // because a later "improvement" that made a hold expire on its own would
      // silently disagree with `UQ_order_holds_open_order`, whose predicate is
      // purely `"releasedAt" IS NULL`.
      const hold = buildHold(null);
      expect(hold.isOpen()).toBe(hold.isOpen());
      expect(OrderHold.prototype.isOpen.length).toBe(0);
    });
  });
});
