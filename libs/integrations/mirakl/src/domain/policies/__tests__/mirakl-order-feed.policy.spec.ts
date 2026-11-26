/**
 * Mirakl Order Feed Policy: unit tests
 *
 * @module libs/integrations/mirakl/src/domain/policies
 */
import {
  buildFeedEventKey,
  computeFeedWindow,
  deriveFeedEventType,
  FEED_BOOTSTRAP_LOOKBACK_MS,
  FEED_OVERLAP_MS,
  FEED_READ_LAG_MS,
  halveFeedWindow,
  INGESTIBLE_ORDER_STATES,
} from '../mirakl-order-feed.policy';

const NOW = new Date('2026-11-23T12:00:00.000Z');

describe('computeFeedWindow', () => {
  it('should end the window the read lag before now', () => {
    const window = computeFeedWindow(null, NOW);
    expect(window.to.getTime()).toBe(NOW.getTime() - FEED_READ_LAG_MS);
  });

  it('should reach back the bootstrap lookback when there is no cursor', () => {
    const window = computeFeedWindow(null, NOW);
    expect(window.from.getTime()).toBe(window.to.getTime() - FEED_BOOTSTRAP_LOOKBACK_MS);
  });

  it('should start the overlap before the cursor when a cursor exists', () => {
    const window = computeFeedWindow('2026-11-23T11:50:00.000Z', NOW);
    expect(window.from.toISOString()).toBe(
      new Date(Date.parse('2026-11-23T11:50:00.000Z') - FEED_OVERLAP_MS).toISOString(),
    );
  });

  it('should start from the bootstrap lookback when the cursor is unreadable', () => {
    const window = computeFeedWindow('not-a-date', NOW);
    expect(window.from.getTime()).toBe(window.to.getTime() - FEED_BOOTSTRAP_LOOKBACK_MS);
  });

  it('should still read the overlap when the cursor is ahead of the clock', () => {
    const window = computeFeedWindow('2026-11-24T00:00:00.000Z', NOW);
    expect(window.from.getTime()).toBe(window.to.getTime() - FEED_OVERLAP_MS);
  });
});

describe('halveFeedWindow', () => {
  it('should keep the start and end halfway', () => {
    const from = new Date('2026-11-23T10:00:00.000Z');
    const to = new Date('2026-11-23T12:00:00.000Z');
    expect(halveFeedWindow({ from, to })).toEqual({
      from,
      to: new Date('2026-11-23T11:00:00.000Z'),
    });
  });
});

describe('INGESTIBLE_ORDER_STATES', () => {
  it('should leave out orders that are not orders yet', () => {
    expect(INGESTIBLE_ORDER_STATES).not.toContain('STAGING');
    expect(INGESTIBLE_ORDER_STATES).not.toContain('WAITING_ACCEPTANCE');
    expect(INGESTIBLE_ORDER_STATES).toContain('SHIPPING');
    expect(INGESTIBLE_ORDER_STATES).toContain('CANCELED');
  });
});

describe('deriveFeedEventType', () => {
  it.each(['CANCELED', 'REFUSED'])('should report cancelled for %s', (state) => {
    expect(deriveFeedEventType(state)).toBe('cancelled');
  });

  it.each(['SHIPPING', 'WAITING_DEBIT', undefined])('should report updated for %p', (state) => {
    expect(deriveFeedEventType(state)).toBe('updated');
  });
});

describe('buildFeedEventKey', () => {
  it('should key on the order and its last update', () => {
    expect(buildFeedEventKey('1001-A', '2026-11-23T10:00:00Z', '2026-11-22T10:00:00Z')).toBe(
      '1001-A:2026-11-23T10:00:00Z',
    );
  });

  it('should fall back to the creation date', () => {
    expect(buildFeedEventKey('1001-A', undefined, '2026-11-22T10:00:00Z')).toBe(
      '1001-A:2026-11-22T10:00:00Z',
    );
  });
});
