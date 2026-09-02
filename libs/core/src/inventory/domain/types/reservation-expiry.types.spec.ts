/**
 * Reservation Expiry Policy — unit tests (#2344)
 *
 * @module libs/core/src/inventory/domain/types
 */
import {
  RESERVATION_TTL_ENV_KEY,
  RESERVATION_TTL_MS_DEFAULT,
  RESERVATION_TTL_MS_MAX,
  RESERVATION_TTL_MS_MIN,
  readReservationTtlMs,
  resolveReservationExpiry,
} from './reservation-expiry.types';

describe('readReservationTtlMs', () => {
  it('should return the default when the variable is absent', () => {
    expect(readReservationTtlMs({})).toBe(RESERVATION_TTL_MS_DEFAULT);
  });

  it('should return the default when the variable is empty or whitespace', () => {
    expect(readReservationTtlMs({ [RESERVATION_TTL_ENV_KEY]: '' })).toBe(
      RESERVATION_TTL_MS_DEFAULT
    );
    expect(readReservationTtlMs({ [RESERVATION_TTL_ENV_KEY]: '   ' })).toBe(
      RESERVATION_TTL_MS_DEFAULT
    );
  });

  it('should honour a valid value inside the band', () => {
    const oneDay = 24 * 60 * 60 * 1000;
    expect(readReservationTtlMs({ [RESERVATION_TTL_ENV_KEY]: String(oneDay) })).toBe(oneDay);
  });

  it('should clamp a value below the floor rather than accepting it', () => {
    expect(readReservationTtlMs({ [RESERVATION_TTL_ENV_KEY]: '1000' })).toBe(
      RESERVATION_TTL_MS_MIN
    );
  });

  it('should clamp a value above the ceiling rather than accepting it', () => {
    expect(readReservationTtlMs({ [RESERVATION_TTL_ENV_KEY]: '999999999999' })).toBe(
      RESERVATION_TTL_MS_MAX
    );
  });

  it('should fall back to the default rather than throwing on a malformed value', () => {
    // A malformed env var must never take reservations offline.
    for (const raw of ['abc', 'NaN', 'Infinity', '-5', '0']) {
      expect(readReservationTtlMs({ [RESERVATION_TTL_ENV_KEY]: raw })).toBe(
        RESERVATION_TTL_MS_DEFAULT
      );
    }
  });
});

describe('resolveReservationExpiry', () => {
  it('should return now plus the ttl', () => {
    const now = new Date('2026-08-26T10:00:00.000Z');
    expect(resolveReservationExpiry(now, 60_000).toISOString()).toBe('2026-08-26T10:01:00.000Z');
  });

  it('should not mutate the supplied instant', () => {
    const now = new Date('2026-08-26T10:00:00.000Z');
    resolveReservationExpiry(now, 60_000);
    expect(now.toISOString()).toBe('2026-08-26T10:00:00.000Z');
  });
});
