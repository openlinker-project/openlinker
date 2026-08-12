/**
 * Ingestion Trust Domain Service Unit Tests
 *
 * @module libs/core/src/analytics-trust/domain/domain-services
 */
import {
  classifyIngestionStatus,
  estimateCronIntervalMs,
  computeStaleAfterMs,
  computeWorstStatus,
} from './ingestion-trust.domain-service';

describe('classifyIngestionStatus', () => {
  const now = new Date('2026-06-01T12:00:00.000Z');

  it('returns never-ingested when lastPollAt is null', () => {
    expect(classifyIngestionStatus(null, 900_000, now)).toBe('never-ingested');
  });

  it('returns never-ingested even when staleAfterMs is null', () => {
    expect(classifyIngestionStatus(null, null, now)).toBe('never-ingested');
  });

  it('returns fresh when the last success is within the threshold', () => {
    const lastSuccess = new Date(now.getTime() - 5 * 60 * 1000); // 5 min ago
    expect(classifyIngestionStatus(lastSuccess, 15 * 60 * 1000, now)).toBe('fresh');
  });

  it('returns fresh exactly at the threshold boundary', () => {
    const lastSuccess = new Date(now.getTime() - 15 * 60 * 1000);
    expect(classifyIngestionStatus(lastSuccess, 15 * 60 * 1000, now)).toBe('fresh');
  });

  it('returns stalled when the last success is older than the threshold', () => {
    const lastSuccess = new Date(now.getTime() - 20 * 60 * 1000); // 20 min ago
    expect(classifyIngestionStatus(lastSuccess, 15 * 60 * 1000, now)).toBe('stalled');
  });

  it('never returns stalled when staleAfterMs is null (unknown cadence)', () => {
    const longAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
    expect(classifyIngestionStatus(longAgo, null, now)).toBe('fresh');
  });
});

describe('estimateCronIntervalMs', () => {
  const now = new Date('2026-06-01T12:00:00.000Z');

  it('computes a 5-minute interval for */5 * * * *', () => {
    expect(estimateCronIntervalMs('*/5 * * * *', now)).toBe(5 * 60 * 1000);
  });

  it('computes a 10-minute interval for */10 * * * *', () => {
    expect(estimateCronIntervalMs('*/10 * * * *', now)).toBe(10 * 60 * 1000);
  });

  it('returns null for a malformed cron expression without throwing', () => {
    expect(estimateCronIntervalMs('not a cron expression', now)).toBeNull();
  });
});

describe('computeStaleAfterMs', () => {
  it('applies the multiplier when the result is above the floor', () => {
    // 5-min poll * 3 = 15 min, above a 10-min floor.
    expect(computeStaleAfterMs(5 * 60 * 1000, 3, 10 * 60 * 1000)).toBe(15 * 60 * 1000);
  });

  it('applies the floor when the multiplied result is below it', () => {
    // 10-min poll * 3 = 30 min, but a 60-min floor should win.
    expect(computeStaleAfterMs(10 * 60 * 1000, 3, 60 * 60 * 1000)).toBe(60 * 60 * 1000);
  });

  it('is exactly the multiplied value when it equals the floor', () => {
    expect(computeStaleAfterMs(10 * 60 * 1000, 3, 30 * 60 * 1000)).toBe(30 * 60 * 1000);
  });
});

describe('computeWorstStatus', () => {
  it('returns fresh for an empty list', () => {
    expect(computeWorstStatus([])).toBe('fresh');
  });

  it('returns fresh when every entry is fresh', () => {
    expect(computeWorstStatus(['fresh', 'fresh'])).toBe('fresh');
  });

  it('ranks unknown as worse than stalled', () => {
    expect(computeWorstStatus(['stalled', 'unknown'])).toBe('unknown');
  });

  it('ranks stalled as worse than never-ingested', () => {
    expect(computeWorstStatus(['never-ingested', 'stalled'])).toBe('stalled');
  });

  it('ranks never-ingested as worse than fresh', () => {
    expect(computeWorstStatus(['fresh', 'never-ingested'])).toBe('never-ingested');
  });

  it('is order-independent', () => {
    expect(computeWorstStatus(['fresh', 'unknown', 'stalled', 'never-ingested'])).toBe('unknown');
  });
});
