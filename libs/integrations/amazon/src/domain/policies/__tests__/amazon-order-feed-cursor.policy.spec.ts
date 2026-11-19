/**
 * Amazon order feed cursor tests (#4178)
 *
 * @module libs/integrations/amazon/src/domain/policies/__tests__
 */
import {
  AMAZON_ORDER_FEED_OVERLAP_MS,
  decodeAmazonOrderFeedCursor,
  encodeAmazonOrderFeedCursor,
  nextAmazonOrderFeedCursor,
} from '../amazon-order-feed-cursor.policy';

const NOW = new Date('2026-11-17T12:00:00.000Z');

describe('decodeAmazonOrderFeedCursor', () => {
  it('should start seven days back when there is no cursor', () => {
    expect(decodeAmazonOrderFeedCursor(null, NOW)).toEqual({ since: '2026-11-10T12:00:00.000Z' });
  });

  it('should start fresh on an unreadable cursor', () => {
    for (const raw of ['nope', '{}', '{"since":"not a date"}', '[]']) {
      expect(decodeAmazonOrderFeedCursor(raw, NOW).since).toBe('2026-11-10T12:00:00.000Z');
    }
  });

  it('should keep a pagination token younger than 24 hours', () => {
    const raw = encodeAmazonOrderFeedCursor({
      since: '2026-11-17T08:00:00.000Z',
      paginationToken: 'tok',
      tokenIssuedAt: '2026-11-17T11:00:00.000Z',
    });
    expect(decodeAmazonOrderFeedCursor(raw, NOW).paginationToken).toBe('tok');
  });

  it('should drop an expired pagination token and restart the window', () => {
    const raw = encodeAmazonOrderFeedCursor({
      since: '2026-11-15T08:00:00.000Z',
      paginationToken: 'old',
      tokenIssuedAt: '2026-11-16T11:00:00.000Z',
    });
    expect(decodeAmazonOrderFeedCursor(raw, NOW)).toEqual({ since: '2026-11-15T08:00:00.000Z' });
  });
});

describe('nextAmazonOrderFeedCursor', () => {
  const current = { since: '2026-11-17T08:00:00.000Z' };

  it('should carry the next page token and keep the window start', () => {
    expect(
      nextAmazonOrderFeedCursor({ current, nextToken: 'p2', windowEnd: undefined, latestUpdatedOnPage: undefined, now: NOW }),
    ).toEqual({ since: current.since, paginationToken: 'p2', tokenIssuedAt: NOW.toISOString() });
  });

  it('should move the watermark to the window end minus the overlap', () => {
    const next = nextAmazonOrderFeedCursor({
      current,
      nextToken: undefined,
      windowEnd: '2026-11-17T11:58:00.000Z',
      latestUpdatedOnPage: '2026-11-17T10:00:00.000Z',
      now: NOW,
    });
    expect(Date.parse(next.since)).toBe(Date.parse('2026-11-17T11:58:00.000Z') - AMAZON_ORDER_FEED_OVERLAP_MS);
    expect(next.paginationToken).toBeUndefined();
  });

  it('should fall back to the latest update on the page, never moving backwards', () => {
    expect(
      nextAmazonOrderFeedCursor({
        current,
        nextToken: undefined,
        windowEnd: undefined,
        latestUpdatedOnPage: '2026-11-17T08:01:00.000Z',
        now: NOW,
      }).since,
    ).toBe(current.since);
  });

  it('should hold the watermark on an empty page with no window end', () => {
    expect(
      nextAmazonOrderFeedCursor({ current, nextToken: undefined, windowEnd: undefined, latestUpdatedOnPage: undefined, now: NOW }),
    ).toEqual(current);
  });
});
