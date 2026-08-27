/**
 * PrestaShop Order-Feed Keyset Cursor Tests
 *
 * @module libs/integrations/prestashop/src/domain/types/__tests__
 */
import {
  formatOrderFeedCursor,
  isAheadOf,
  isAlreadyConsumed,
  normalizeWallClock,
  parseOrderFeedCursor,
  shiftWallClockSeconds,
} from '../prestashop-order-feed-cursor.types';

describe('prestashop order-feed cursor', () => {
  describe('formatOrderFeedCursor', () => {
    it('should emit one format for every read position', () => {
      expect(formatOrderFeedCursor({ updatedAt: '2024-01-01 10:00:00', lastOrderId: 7 })).toBe(
        '2024-01-01 10:00:00|7'
      );
      expect(formatOrderFeedCursor({ updatedAt: '2024-01-01 10:00:00', lastOrderId: 0 })).toBe(
        '2024-01-01 10:00:00|0'
      );
    });
  });

  describe('parseOrderFeedCursor', () => {
    it('should round-trip a keyset cursor', () => {
      expect(parseOrderFeedCursor('2024-01-01 10:00:00|42')).toEqual({
        updatedAt: '2024-01-01 10:00:00',
        lastOrderId: 42,
      });
    });

    it('should read a legacy bare-timestamp cursor as the start of that second', () => {
      expect(parseOrderFeedCursor('2024-01-01 10:00:00')).toEqual({
        updatedAt: '2024-01-01 10:00:00',
        lastOrderId: 0,
      });
    });

    it('should read a legacy ISO cursor without shifting the wall clock', () => {
      expect(parseOrderFeedCursor('2024-01-01T10:00:00Z')).toEqual({
        updatedAt: '2024-01-01 10:00:00',
        lastOrderId: 0,
      });
    });

    it('should return null for an unreadable cursor rather than a guess', () => {
      expect(parseOrderFeedCursor('not-a-date')).toBeNull();
      expect(parseOrderFeedCursor('')).toBeNull();
      expect(parseOrderFeedCursor(null)).toBeNull();
    });
  });

  describe('normalizeWallClock', () => {
    it('should keep the shop digits exactly as they arrived', () => {
      expect(normalizeWallClock('2024-06-01 23:59:59')).toBe('2024-06-01 23:59:59');
    });

    it('should return null for a non-string or unparseable value', () => {
      expect(normalizeWallClock(undefined)).toBeNull();
      expect(normalizeWallClock(1717200000)).toBeNull();
      expect(normalizeWallClock('0000-00-00 00:00:00')).toBe('0000-00-00 00:00:00');
    });
  });

  describe('shiftWallClockSeconds', () => {
    it('should step back one second across a minute boundary', () => {
      expect(shiftWallClockSeconds('2024-01-01 10:00:00', -1)).toBe('2024-01-01 09:59:59');
    });

    it('should not depend on the host timezone', () => {
      const original = process.env.TZ;
      const shiftIn = (tz: string): string => {
        process.env.TZ = tz;
        return shiftWallClockSeconds('2024-03-31 02:30:00', -1);
      };
      try {
        expect(shiftIn('UTC')).toBe(shiftIn('Europe/Warsaw'));
        expect(shiftIn('Pacific/Kiritimati')).toBe('2024-03-31 02:29:59');
      } finally {
        process.env.TZ = original;
      }
    });
  });

  describe('isAlreadyConsumed', () => {
    const cursor = { updatedAt: '2024-01-01 10:00:00', lastOrderId: 5 };

    it('should treat an earlier second as consumed', () => {
      expect(isAlreadyConsumed(cursor, '2024-01-01 09:59:59', 999)).toBe(true);
    });

    it('should treat a later second as fresh whatever the id', () => {
      expect(isAlreadyConsumed(cursor, '2024-01-01 10:00:01', 1)).toBe(false);
    });

    it('should split the cursor own second on the id', () => {
      expect(isAlreadyConsumed(cursor, '2024-01-01 10:00:00', 5)).toBe(true);
      expect(isAlreadyConsumed(cursor, '2024-01-01 10:00:00', 6)).toBe(false);
    });
  });

  describe('isAheadOf', () => {
    it('should reject a candidate that moves the read position backwards', () => {
      const current = { updatedAt: '2024-01-02 00:00:00', lastOrderId: 3 };
      expect(isAheadOf({ updatedAt: '2024-01-01 00:00:00', lastOrderId: 99 }, current)).toBe(false);
      expect(isAheadOf({ updatedAt: '2024-01-02 00:00:00', lastOrderId: 3 }, current)).toBe(false);
      expect(isAheadOf({ updatedAt: '2024-01-02 00:00:00', lastOrderId: 4 }, current)).toBe(true);
    });
  });
});
