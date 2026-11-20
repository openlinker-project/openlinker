import {
  EMPTY_SHOPIFY_FEED_CURSOR,
  formatShopifyFeedCursor,
  isAfterShopifyCursor,
  parseShopifyFeedCursor,
} from '../shopify-order-feed-cursor.mapper';

describe('Shopify order feed cursor', () => {
  it('should round-trip a cursor it wrote', () => {
    const cursor = { updatedAt: '2026-11-05T10:00:00.000Z', orderId: '1011' };

    expect(parseShopifyFeedCursor(formatShopifyFeedCursor(cursor), 'c1')).toEqual(cursor);
  });

  it.each([null, undefined, '', '   '])('should start from the beginning when there is no cursor (%p)', (raw) => {
    expect(parseShopifyFeedCursor(raw, 'c1')).toEqual(EMPTY_SHOPIFY_FEED_CURSOR);
  });

  it.each(['allegro-event-1', 'v1|not-a-date|1', 'v1|2026-11-05T10:00:00Z|abc', 'v2|2026-11-05T10:00:00Z|1'])(
    'should refuse a value it did not write (%s)',
    (raw) => {
      expect(() => parseShopifyFeedCursor(raw, 'c1')).toThrow(RangeError);
    },
  );

  it('should not format an empty cursor', () => {
    expect(formatShopifyFeedCursor(EMPTY_SHOPIFY_FEED_CURSOR)).toBeNull();
  });

  it('should order by time first, then by order id at the same time', () => {
    const cursor = { updatedAt: '2026-11-05T10:00:00.000Z', orderId: '1011' };

    expect(isAfterShopifyCursor(cursor, '2026-11-05T10:00:01Z', '1')).toBe(true);
    expect(isAfterShopifyCursor(cursor, '2026-11-05T09:59:59Z', '9999')).toBe(false);
    expect(isAfterShopifyCursor(cursor, '2026-11-05T10:00:00Z', '1012')).toBe(true);
    expect(isAfterShopifyCursor(cursor, '2026-11-05T10:00:00Z', '1011')).toBe(false);
  });

  it('should compare order ids as numbers, not as text', () => {
    const cursor = { updatedAt: '2026-11-05T10:00:00.000Z', orderId: '9' };

    expect(isAfterShopifyCursor(cursor, '2026-11-05T10:00:00Z', '10')).toBe(true);
  });
});
