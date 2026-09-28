/**
 * Unassigned-age formatting (#3424) — deterministic against an explicit
 * `now`, the `format-ship-by.test.ts` precedent.
 */
import { describe, expect, it } from 'vitest';

import {
  formatCompactDuration,
  formatUnassignedAge,
  oldestUnassignedSince,
} from './assign-packing-work-duration';

const NOW = new Date('2026-06-01T12:00:00.000Z');

describe('formatCompactDuration', () => {
  it('reports minutes under an hour', () => {
    expect(formatCompactDuration(52 * 60_000)).toBe('52m');
    expect(formatCompactDuration(0)).toBe('0m');
    expect(formatCompactDuration(59 * 60_000)).toBe('59m');
  });

  it('rolls over to hours at exactly 60 minutes', () => {
    expect(formatCompactDuration(60 * 60_000)).toBe('1h');
    expect(formatCompactDuration(3 * 60 * 60_000)).toBe('3h');
    expect(formatCompactDuration(23 * 60 * 60_000)).toBe('23h');
  });

  it('rolls over to days at exactly 24 hours', () => {
    expect(formatCompactDuration(24 * 60 * 60_000)).toBe('1d');
    expect(formatCompactDuration(2 * 24 * 60 * 60_000)).toBe('2d');
  });

  it('clamps a negative or non-finite duration to zero rather than throwing', () => {
    expect(formatCompactDuration(-5000)).toBe('0m');
    expect(formatCompactDuration(Number.NaN)).toBe('0m');
    expect(formatCompactDuration(Number.POSITIVE_INFINITY)).toBe('0m');
  });
});

describe('formatUnassignedAge', () => {
  it('returns null for a null or undefined instant — never "0m"', () => {
    expect(formatUnassignedAge(null, NOW)).toBeNull();
    expect(formatUnassignedAge(undefined, NOW)).toBeNull();
  });

  it('returns null for an unparseable instant', () => {
    expect(formatUnassignedAge('not-a-date', NOW)).toBeNull();
  });

  it('formats a real elapsed instant', () => {
    expect(formatUnassignedAge('2026-06-01T11:08:00.000Z', NOW)).toBe('52m');
    expect(formatUnassignedAge('2026-06-01T09:00:00.000Z', NOW)).toBe('3h');
    expect(formatUnassignedAge('2026-05-30T12:00:00.000Z', NOW)).toBe('2d');
  });
});

describe('oldestUnassignedSince', () => {
  it('returns null when there is no pooled task', () => {
    expect(oldestUnassignedSince([{ assignedToUserId: 'u_a', unassignedSince: '2026-06-01T09:00:00.000Z' }])).toBeNull();
    expect(oldestUnassignedSince([])).toBeNull();
  });

  it('returns null when every pooled task has an unknown age', () => {
    expect(
      oldestUnassignedSince([
        { assignedToUserId: null, unassignedSince: null },
        { assignedToUserId: null, unassignedSince: undefined },
      ])
    ).toBeNull();
  });

  it('picks the oldest among several pooled tasks, ignoring assigned and unknown-age ones', () => {
    expect(
      oldestUnassignedSince([
        { assignedToUserId: 'u_a', unassignedSince: '2026-05-01T00:00:00.000Z' },
        { assignedToUserId: null, unassignedSince: null },
        { assignedToUserId: null, unassignedSince: '2026-06-01T11:08:00.000Z' },
        { assignedToUserId: null, unassignedSince: '2026-06-01T09:00:00.000Z' },
      ])
    ).toBe('2026-06-01T09:00:00.000Z');
  });

  it('ignores an unparseable unassignedSince rather than letting it win the comparison', () => {
    expect(
      oldestUnassignedSince([
        { assignedToUserId: null, unassignedSince: 'not-a-date' },
        { assignedToUserId: null, unassignedSince: '2026-06-01T09:00:00.000Z' },
      ])
    ).toBe('2026-06-01T09:00:00.000Z');
  });
});
