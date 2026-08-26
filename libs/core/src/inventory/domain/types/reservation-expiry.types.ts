/**
 * Reservation Expiry Policy (#2344, ADR-061 decision 1)
 *
 * `Reservation.expiresAt` is MANDATORY: an unbounded hold on a system that may
 * never observe the close event is an oversell leak with no floor. A caller may
 * state its own expiry; when it does not, this module resolves one.
 *
 * The TTL is a **floor under a leak, not the intended lifetime**. #2346's
 * state-dependent sweep *extends* — never releases — a reservation whose order
 * still carries live OL-executed work, and an expiry is never extended as a side
 * effect of re-reserving (`expiresAt`, like `atpEffect`, is honoured only on
 * insert).
 *
 * No design document states a TTL value; the default here is a project choice,
 * and its blast radius is stamp-dependent. On an `atpEffect: 'diagnostic'` hold
 * it subtracts from nothing and a long TTL is harmless. On a `'published'` hold
 * an unclosed reservation is exactly ANALYSIS-1032's over-subtraction harm — a
 * seller with 3 units and a buffer of 1 publishing 0 after selling 1, for the
 * whole TTL. Because the default topology (`omp_fulfilled`) stamps
 * `'diagnostic'`, a default install is unexposed; an install that configures
 * `ol_managed_carrier` routing is the one that should tune this.
 *
 * Pure per `docs/engineering-standards.md § The pure-rule exception` — the
 * environment is an argument, not a global read (the `isTaxRateEnforced` /
 * `readStockSafetyBuffer` precedent).
 *
 * @module libs/core/src/inventory/domain/types
 */

/** Seven days. */
export const RESERVATION_TTL_MS_DEFAULT = 7 * 24 * 60 * 60 * 1000;

/** One hour. Below this a hold expires before an ordinary fulfilment window. */
export const RESERVATION_TTL_MS_MIN = 60 * 60 * 1000;

/** Ninety days. Above this "time-boxed" stops meaning anything. */
export const RESERVATION_TTL_MS_MAX = 90 * 24 * 60 * 60 * 1000;

export const RESERVATION_TTL_ENV_KEY = 'OL_RESERVATION_TTL_MS';

/**
 * Coerce `OL_RESERVATION_TTL_MS` into a usable TTL.
 *
 * An absent, non-numeric, non-finite or non-positive value falls back to the
 * default rather than throwing: a malformed env var must not take reservations
 * offline, and the clamp keeps any accepted value inside a defensible band (the
 * `OL_WEBHOOK_SKEW_WINDOW_MS` precedent).
 */
export function readReservationTtlMs(env: Readonly<Record<string, string | undefined>>): number {
  const raw = env[RESERVATION_TTL_ENV_KEY];
  if (raw === undefined || raw.trim() === '') return RESERVATION_TTL_MS_DEFAULT;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return RESERVATION_TTL_MS_DEFAULT;

  return Math.min(RESERVATION_TTL_MS_MAX, Math.max(RESERVATION_TTL_MS_MIN, Math.trunc(parsed)));
}

/** `now + ttl`, as the instant a hold stops being live. */
export function resolveReservationExpiry(now: Date, ttlMs: number): Date {
  return new Date(now.getTime() + ttlMs);
}
