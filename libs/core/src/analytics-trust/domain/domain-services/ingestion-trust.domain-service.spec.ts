/**
 * Ingestion Trust Domain Service Unit Tests
 *
 * @module libs/core/src/analytics-trust/domain/domain-services
 */
import { classifyIngestionStatus, estimateCronIntervalMs } from './ingestion-trust.domain-service';

describe('classifyIngestionStatus', () => {
  const now = new Date('2026-06-01T12:00:00.000Z');

  it('returns never-ingested when lastSuccessfulIngestionAt is null', () => {
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
