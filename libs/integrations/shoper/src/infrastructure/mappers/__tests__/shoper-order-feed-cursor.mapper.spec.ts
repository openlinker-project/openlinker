import {
  EMPTY_SHOPER_FEED_CURSOR,
  formatShoperFeedCursor,
  isWallClock,
  laterWallClock,
  parseShoperFeedCursor,
  shiftWallClockBack,
} from '../shoper-order-feed-cursor.mapper';

describe('shoper-order-feed-cursor.mapper', () => {
  describe('parse / format', () => {
    it('should round-trip every field', () => {
      const cursor = {
        lastOrderId: '42',
        statusWatermark: '2026-10-20 12:00:00',
        statusPassStart: '2026-10-20 11:55:00',
        statusNextPage: 3,
      };

      const raw = formatShoperFeedCursor(cursor);

      expect(raw).toBe('v2|42|2026-10-20 12:00:00|2026-10-20 11:55:00|3');
      expect(parseShoperFeedCursor(raw, 'c')).toEqual(cursor);
    });

    it('should start from nothing on a null cursor', () => {
      expect(parseShoperFeedCursor(null, 'c')).toEqual(EMPTY_SHOPER_FEED_CURSOR);
      expect(formatShoperFeedCursor(EMPTY_SHOPER_FEED_CURSOR)).toBe('v2||||');
    });

    it('should read a bare order id as the cursor written before the status pass existed', () => {
      expect(parseShoperFeedCursor('16', 'c')).toEqual({ ...EMPTY_SHOPER_FEED_CURSOR, lastOrderId: '16' });
    });

    it('should refuse a cursor whose order id cannot be read', () => {
      expect(() => parseShoperFeedCursor('abc', 'c')).toThrow(RangeError);
      expect(() => parseShoperFeedCursor('', 'c')).toThrow(RangeError);
      expect(() => parseShoperFeedCursor('v2|x|||', 'c')).toThrow(RangeError);
      expect(() => parseShoperFeedCursor('v2|1||', 'c')).toThrow(RangeError);
    });

    it('should restart only the status pass when its part is unreadable', () => {
      expect(parseShoperFeedCursor('v2|5|yesterday||', 'c')).toEqual({ ...EMPTY_SHOPER_FEED_CURSOR, lastOrderId: '5' });
    });

    it('should drop a half-written resumable pass but keep the watermark', () => {
      expect(parseShoperFeedCursor('v2|5|2026-10-20 12:00:00|2026-10-20 11:55:00|', 'c')).toEqual({
        lastOrderId: '5',
        statusWatermark: '2026-10-20 12:00:00',
        statusPassStart: null,
        statusNextPage: null,
      });
    });
  });

  describe('wall clocks', () => {
    it('should recognise only a real, fixed-width timestamp', () => {
      expect(isWallClock('2026-10-20 12:00:00')).toBe(true);
      expect(isWallClock('2026-02-30 12:00:00')).toBe(false);
      expect(isWallClock('2026-10-20T12:00:00')).toBe(false);
      expect(isWallClock(null)).toBe(false);
    });

    it('should shift back across a day and a year boundary', () => {
      expect(shiftWallClockBack('2026-10-20 12:00:00', 300)).toBe('2026-10-20 11:55:00');
      expect(shiftWallClockBack('2027-01-01 00:02:00', 300)).toBe('2026-12-31 23:57:00');
    });

    it('should keep the later of two timestamps and tolerate an unset one', () => {
      expect(laterWallClock('2026-10-20 12:00:00', '2026-10-20 11:59:59')).toBe('2026-10-20 12:00:00');
      expect(laterWallClock(null, '2026-10-20 11:59:59')).toBe('2026-10-20 11:59:59');
      expect(laterWallClock('2026-10-20 12:00:00', null)).toBe('2026-10-20 12:00:00');
    });
  });
});
