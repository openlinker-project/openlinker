/**
 * formatShipBy tests (#927) — deterministic against an explicit `now`.
 */
import { describe, expect, it } from 'vitest';
import { formatShipBy } from './format-ship-by';

const NOW = new Date('2026-06-01T12:00:00.000Z');

describe('formatShipBy', () => {
  it('returns null for a missing or unparseable deadline', () => {
    expect(formatShipBy(null, NOW)).toBeNull();
    expect(formatShipBy('not-a-date', NOW)).toBeNull();
  });

  it('is "ok" with days remaining when the deadline is far out', () => {
    const result = formatShipBy('2026-06-03T12:00:00.000Z', NOW);
    expect(result).toEqual({ level: 'ok', remaining: '2d left' });
  });

  it('is "soon" within the 24h threshold (hours)', () => {
    const result = formatShipBy('2026-06-01T15:00:00.000Z', NOW);
    expect(result).toEqual({ level: 'soon', remaining: '3h left' });
  });

  it('treats exactly 24h out as "soon"', () => {
    expect(formatShipBy('2026-06-02T12:00:00.000Z', NOW)?.level).toBe('soon');
  });

  it('treats just over 24h out as "ok"', () => {
    expect(formatShipBy('2026-06-02T12:00:00.001Z', NOW)?.level).toBe('ok');
  });

  it('reports minutes when under an hour', () => {
    expect(formatShipBy('2026-06-01T12:45:00.000Z', NOW)).toEqual({
      level: 'soon',
      remaining: '45m left',
    });
  });

  it('is "overdue" with magnitude when past the deadline', () => {
    expect(formatShipBy('2026-06-01T08:00:00.000Z', NOW)).toEqual({
      level: 'overdue',
      remaining: 'Overdue 4h',
    });
  });

  it('says "due now" at the exact deadline', () => {
    expect(formatShipBy('2026-06-01T12:00:00.000Z', NOW)).toEqual({
      level: 'overdue',
      remaining: 'due now',
    });
  });
});
