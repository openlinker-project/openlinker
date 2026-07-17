/**
 * Unit tests for invoice-sweep-support helpers (#1585).
 *
 * Pins the length-bounded `sanitizeError` and the weekend-excluding
 * `businessMillisElapsed` used by the lingering-deadline WARN (#1585 F6).
 *
 * @module libs/core/src/invoicing/application/services
 */
import {
  MAX_ERROR_MESSAGE_LENGTH,
  businessMillisElapsed,
  sanitizeError,
} from './invoice-sweep-support';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('sanitizeError', () => {
  it('returns a short message unchanged', () => {
    expect(sanitizeError(new Error('boom'))).toBe('boom');
  });

  it('truncates an over-long message and appends the marker', () => {
    const raw = 'x'.repeat(MAX_ERROR_MESSAGE_LENGTH + 100);
    const out = sanitizeError(raw);
    expect(out.length).toBe(MAX_ERROR_MESSAGE_LENGTH);
    expect(out.endsWith('…[truncated]')).toBe(true);
  });
});

describe('businessMillisElapsed (#1585 F6)', () => {
  it('returns 0 when to <= from', () => {
    const t = new Date('2026-06-15T10:00:00Z'); // Monday
    expect(businessMillisElapsed(t, t)).toBe(0);
    expect(businessMillisElapsed(t, new Date(t.getTime() - HOUR))).toBe(0);
  });

  it('counts full elapsed time across weekdays', () => {
    // Mon 08:00 -> Tue 08:00 UTC — a full weekday span.
    const from = new Date('2026-06-15T08:00:00Z');
    const to = new Date('2026-06-16T08:00:00Z');
    expect(businessMillisElapsed(from, to)).toBe(DAY);
  });

  it('excludes a full weekend (Sat + Sun)', () => {
    // Fri 12:00 -> Mon 12:00 UTC spans 3 wall-clock days but only Fri-afternoon
    // + Mon-morning are business time (Sat + Sun excluded): 12h Fri + 12h Mon.
    const from = new Date('2026-06-19T12:00:00Z'); // Friday
    const to = new Date('2026-06-22T12:00:00Z'); // Monday
    expect(businessMillisElapsed(from, to)).toBe(24 * HOUR);
  });

  it('does not accrue over a Friday-evening -> Saturday window', () => {
    // Fri 20:00 -> Sat 20:00 UTC: only the 4h of Friday count.
    const from = new Date('2026-06-19T20:00:00Z'); // Friday
    const to = new Date('2026-06-20T20:00:00Z'); // Saturday
    expect(businessMillisElapsed(from, to)).toBe(4 * HOUR);
  });
});
