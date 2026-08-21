import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toExclusiveEndInstant } from './sales-analytics.api';

describe('toExclusiveEndInstant', () => {
  const originalTZ = process.env.TZ;

  beforeEach(() => {
    process.env.TZ = 'America/New_York'; // UTC-4/-5, exercises a negative offset
  });

  afterEach(() => {
    process.env.TZ = originalTZ;
  });

  it('anchors on UTC midnight of the day after `to`, not local midnight', () => {
    // Local midnight for 2026-03-15 in America/New_York is 2026-03-15T04:00:00Z —
    // a UTC anchor must not drift onto that local instant.
    expect(toExclusiveEndInstant('2026-03-14')).toBe('2026-03-15T00:00:00.000Z');
  });

  it('rolls over month and year boundaries in UTC', () => {
    expect(toExclusiveEndInstant('2026-01-31')).toBe('2026-02-01T00:00:00.000Z');
    expect(toExclusiveEndInstant('2025-12-31')).toBe('2026-01-01T00:00:00.000Z');
  });
});
