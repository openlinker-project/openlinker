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

/**
 * How long a hold may keep being extended before the sweep says so (#2346).
 *
 * The second bound, and it exists because the first one stops working when the
 * obligation source is missing. Fail-closed means *indeterminate ⇒ extend*, and
 * with no `order_holds` table (#2339) that is true forever — so without an age
 * bound the sweep re-extends every hold on every tick in perpetuity, the `held`
 * set never drains, and the stuck state is completely invisible.
 *
 * Past this age the sweep **still extends and still never releases** — releasing
 * is what oversells, and no amount of elapsed time makes a possibly-promised
 * unit safe to republish. What changes is that the hold is counted and logged,
 * so an operator can find it. Bounding by age rather than by an extension
 * counter is the #2330 returns-sweep precedent, and it needs no column: the
 * hold's own `createdAt` already carries the answer.
 *
 * Thirty days: comfortably past any ordinary fulfilment window, so a hold that
 * reaches it is stuck rather than slow.
 */
export const RESERVATION_OBLIGATION_MAX_AGE_MS_DEFAULT = 30 * 24 * 60 * 60 * 1000;

/** One day. Below this an ordinary in-flight order would be reported stuck. */
export const RESERVATION_OBLIGATION_MAX_AGE_MS_MIN = 24 * 60 * 60 * 1000;

/** One year. Above this the bound stops bounding anything. */
export const RESERVATION_OBLIGATION_MAX_AGE_MS_MAX = 365 * 24 * 60 * 60 * 1000;

export const RESERVATION_OBLIGATION_MAX_AGE_ENV_KEY = 'OL_RESERVATION_OBLIGATION_MAX_AGE_MS';

/**
 * Coerce `OL_RESERVATION_OBLIGATION_MAX_AGE_MS` into a usable bound.
 *
 * Same posture as {@link readReservationTtlMs}: a malformed value falls back to
 * the default rather than throwing, since a typo must not take the sweep
 * offline, and the clamp keeps any accepted value inside a defensible band.
 */
export function readReservationObligationMaxAgeMs(
  env: Readonly<Record<string, string | undefined>>
): number {
  const raw = env[RESERVATION_OBLIGATION_MAX_AGE_ENV_KEY];
  if (raw === undefined || raw.trim() === '') return RESERVATION_OBLIGATION_MAX_AGE_MS_DEFAULT;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return RESERVATION_OBLIGATION_MAX_AGE_MS_DEFAULT;

  return Math.min(
    RESERVATION_OBLIGATION_MAX_AGE_MS_MAX,
    Math.max(RESERVATION_OBLIGATION_MAX_AGE_MS_MIN, Math.trunc(parsed))
  );
}
