import { describe, expect, it } from 'vitest';
import { shouldShowDegradationBanner } from './ingestion-trust.lib';
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

describe('shouldShowDegradationBanner', () => {
  it('should return an empty list when no connections are stalled or disconnected', () => {
    const entries = [makeEntry('fresh'), makeEntry('never-ingested'), makeEntry('unknown')];

    expect(shouldShowDegradationBanner(entries)).toEqual([]);
  });

  it('should include a stalled connection', () => {
    const stalled = makeEntry('stalled', { connectionId: 'conn-stalled' });

    expect(shouldShowDegradationBanner([makeEntry('fresh'), stalled])).toEqual([stalled]);
  });

  it('should include a disconnected connection', () => {
    const disconnected = makeEntry('disconnected', { connectionId: 'conn-disconnected' });

    expect(shouldShowDegradationBanner([disconnected])).toEqual([disconnected]);
  });

  it('should exclude fresh, never-ingested, and unknown connections', () => {
    const fresh = makeEntry('fresh');
    const neverIngested = makeEntry('never-ingested');
    const unknown = makeEntry('unknown');

    expect(shouldShowDegradationBanner([fresh, neverIngested, unknown])).toEqual([]);
  });

  it('should return every degraded connection, not just the first', () => {
    const first = makeEntry('stalled', { connectionId: 'first' });
    const second = makeEntry('disconnected', { connectionId: 'second' });

    expect(shouldShowDegradationBanner([first, makeEntry('fresh'), second])).toEqual([
      first,
      second,
    ]);
  });
});
