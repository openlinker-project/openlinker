/**
 * Unit tests for the `Retry-After` coercion (#2613).
 *
 * @module libs/integrations/prestashop/src/infrastructure/http
 */
import { parseRetryAfterSeconds } from '../prestashop-retry-after.types';

describe('parseRetryAfterSeconds', () => {
  const now = new Date('2026-08-27T10:00:00.000Z');

  it('should read a delay-seconds header', () => {
    expect(parseRetryAfterSeconds('90', now)).toBe(90);
  });

  it('should read an HTTP-date header as the remaining seconds', () => {
    expect(parseRetryAfterSeconds('Thu, 27 Aug 2026 10:02:00 GMT', now)).toBe(120);
  });

  it('should treat an absent, empty or unparseable header as no wait at all', () => {
    expect(parseRetryAfterSeconds(null, now)).toBeUndefined();
    expect(parseRetryAfterSeconds(undefined, now)).toBeUndefined();
    expect(parseRetryAfterSeconds('  ', now)).toBeUndefined();
    expect(parseRetryAfterSeconds('soon', now)).toBeUndefined();
  });

  it('should ignore a zero or already-past wait rather than requeue immediately', () => {
    expect(parseRetryAfterSeconds('0', now)).toBeUndefined();
    expect(parseRetryAfterSeconds('Thu, 27 Aug 2026 09:59:00 GMT', now)).toBeUndefined();
  });

  it('should cap an implausibly long wait so a job cannot be parked for days', () => {
    expect(parseRetryAfterSeconds('999999', now)).toBe(3600);
  });
});
