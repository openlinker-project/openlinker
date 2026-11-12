import { formatShopifyReturnFeedCursor, parseShopifyReturnFeedCursor } from '../shopify-return-feed-cursor.mapper';

const NOW = new Date('2026-11-05T12:00:00Z');

describe('Shopify return feed cursor', () => {
  it('should round-trip a cursor mid-lap and at a lap start', () => {
    const midLap = { lapStartedAt: '2026-11-05T09:00:00.000Z', belowOrderId: '1019' };
    const lapStart = { lapStartedAt: '2026-11-05T09:00:00.000Z', belowOrderId: null };

    expect(parseShopifyReturnFeedCursor(formatShopifyReturnFeedCursor(midLap), 'c1', NOW)).toEqual(midLap);
    expect(parseShopifyReturnFeedCursor(formatShopifyReturnFeedCursor(lapStart), 'c1', NOW)).toEqual(lapStart);
  });

  it.each([null, undefined, ''])('should start a lap now when there is no cursor (%p)', (raw) => {
    expect(parseShopifyReturnFeedCursor(raw, 'c1', NOW)).toEqual({
      lapStartedAt: NOW.toISOString(),
      belowOrderId: null,
    });
  });

  it('should start a fresh lap from a cursor of the ascending walk, whose order id points the other way', () => {
    expect(parseShopifyReturnFeedCursor('rv1|2026-11-05T09:00:00.000Z|1019', 'c1', NOW)).toEqual({
      lapStartedAt: NOW.toISOString(),
      belowOrderId: null,
    });
  });

  it.each(['v1|2026-11-05T09:00:00Z|1', 'rv2|not-a-date|1', 'rv2|2026-11-05T09:00:00Z|abc', 'rv2|2026-11-05T09:00:00Z'])(
    'should refuse a value it did not write (%s)',
    (raw) => {
      expect(() => parseShopifyReturnFeedCursor(raw, 'c1', NOW)).toThrow(RangeError);
    },
  );
});
