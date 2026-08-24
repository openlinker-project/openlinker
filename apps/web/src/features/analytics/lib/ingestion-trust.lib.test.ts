import { describe, expect, it } from 'vitest';
import { resolveEarliestOrderDate, selectDegradedConnections } from './ingestion-trust.lib';
import type { ConnectionIngestionStatus, ConnectionIngestionTrust } from '../api/analytics-trust.types';

function makeEntry(
  status: ConnectionIngestionStatus,
  overrides: Partial<ConnectionIngestionTrust> = {},
): ConnectionIngestionTrust {
  return {
    connectionId: 'conn-1',
    connectionName: 'Allegro — main',
    platformType: 'allegro',
    connectionStatus: 'active',
    status,
    lastPollAt: null,
    lastOrderIngestedAt: null,
    connectionCreatedAt: '2026-01-01T00:00:00.000Z',
    earliestOrderDate: '2026-01-05T00:00:00.000Z',
    expectedIntervalMs: null,
    staleAfterMs: null,
    ...overrides,
  };
}

describe('selectDegradedConnections', () => {
  it('should return an empty list when no connections are stalled or disconnected', () => {
    const entries = [makeEntry('fresh'), makeEntry('never-ingested'), makeEntry('unknown')];

    expect(selectDegradedConnections(entries)).toEqual([]);
  });

  it('should include a stalled connection', () => {
    const stalled = makeEntry('stalled', { connectionId: 'conn-stalled' });

    expect(selectDegradedConnections([makeEntry('fresh'), stalled])).toEqual([stalled]);
  });

  it('should include a disconnected connection', () => {
    const disconnected = makeEntry('disconnected', { connectionId: 'conn-disconnected' });

    expect(selectDegradedConnections([disconnected])).toEqual([disconnected]);
  });

  it('should exclude fresh, never-ingested, and unknown connections', () => {
    const fresh = makeEntry('fresh');
    const neverIngested = makeEntry('never-ingested');
    const unknown = makeEntry('unknown');

    expect(selectDegradedConnections([fresh, neverIngested, unknown])).toEqual([]);
  });

  it('should return every degraded connection, not just the first', () => {
    const first = makeEntry('stalled', { connectionId: 'first' });
    const second = makeEntry('disconnected', { connectionId: 'second' });

    expect(selectDegradedConnections([first, makeEntry('fresh'), second])).toEqual([
      first,
      second,
    ]);
  });
});

describe('resolveEarliestOrderDate', () => {
  it('should return null when nothing has ever ingested', () => {
    const entries = [makeEntry('never-ingested', { earliestOrderDate: null })];

    expect(resolveEarliestOrderDate(entries)).toBeNull();
  });

  it('should return the earliest date across every connection when unscoped', () => {
    const entries = [
      makeEntry('fresh', { connectionId: 'a', earliestOrderDate: '2026-07-30T10:59:51.000Z' }),
      makeEntry('fresh', { connectionId: 'b', earliestOrderDate: '2026-06-22T10:37:39.849Z' }),
      makeEntry('never-ingested', { connectionId: 'c', earliestOrderDate: null }),
    ];

    expect(resolveEarliestOrderDate(entries)).toBe('2026-06-22T10:37:39.849Z');
  });

  it('should scope to a single connection when sourceConnectionId is given', () => {
    const entries = [
      makeEntry('fresh', { connectionId: 'a', earliestOrderDate: '2026-07-30T10:59:51.000Z' }),
      makeEntry('fresh', { connectionId: 'b', earliestOrderDate: '2026-06-22T10:37:39.849Z' }),
    ];

    expect(resolveEarliestOrderDate(entries, 'a')).toBe('2026-07-30T10:59:51.000Z');
  });

  it('should return null when sourceConnectionId matches no connection', () => {
    const entries = [makeEntry('fresh', { connectionId: 'a' })];

    expect(resolveEarliestOrderDate(entries, 'does-not-exist')).toBeNull();
  });
});
