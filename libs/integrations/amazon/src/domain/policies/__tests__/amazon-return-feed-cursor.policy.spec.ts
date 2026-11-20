/**
 * Amazon return feed cursor tests (#4184)
 *
 * @module libs/integrations/amazon/src/domain/policies/__tests__
 */
import { decodeAmazonReturnFeedCursor, encodeAmazonReturnFeedCursor } from '../amazon-return-feed-cursor.policy';

const NOW = new Date('2026-11-18T00:00:00Z');

describe('decodeAmazonReturnFeedCursor', () => {
  it('should bootstrap 30 days back without a cursor or with an unreadable one', () => {
    const bootstrap = { step: 'idle', until: '2026-10-19T00:00:00.000Z' };
    expect(decodeAmazonReturnFeedCursor(null, NOW)).toEqual(bootstrap);
    expect(decodeAmazonReturnFeedCursor('{oops', NOW)).toEqual(bootstrap);
    expect(decodeAmazonReturnFeedCursor('{"step":"pending"}', NOW)).toEqual(bootstrap);
  });

  it('should round-trip every step', () => {
    for (const cursor of [
      { step: 'idle', until: '2026-11-01T00:00:00.000Z' },
      { step: 'pending', reportId: 'R1', until: '2026-11-01T00:00:00.000Z' },
      { step: 'reading', reportDocumentId: 'D1', until: '2026-11-01T00:00:00.000Z', offset: 100 },
    ] as const) {
      expect(decodeAmazonReturnFeedCursor(encodeAmazonReturnFeedCursor(cursor), NOW)).toEqual(cursor);
    }
  });

  it('should treat a reading step with a bad offset as idle', () => {
    expect(
      decodeAmazonReturnFeedCursor('{"step":"reading","reportDocumentId":"D","until":"2026-11-01T00:00:00Z","offset":-1}', NOW),
    ).toEqual({ step: 'idle', until: '2026-11-01T00:00:00Z' });
  });
});
