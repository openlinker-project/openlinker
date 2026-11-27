/**
 * Order Change Open TTL (#2333, #3540)
 *
 * How long an unanswered proposal may hold its target's slot - and, since #3540,
 * how long it may keep an order reading `amending`. ONE resolution shared by the
 * service's lazy expiry and by every read that must agree with it: an open row
 * older than this is NOT open, whether or not anything has yet moved it to
 * `expired`.
 *
 * Clamped rather than trusted, following `OL_WEBHOOK_SKEW_WINDOW_MS`: a zero or
 * negative value would expire every proposal the instant it was opened, and an
 * unbounded one would reinstate the permanent lock ADR-044 requires `EXPIRED` to
 * prevent. Always a finite integer, so it is safe to interpolate as a SQL bound.
 *
 * @module libs/core/src/orders/domain/types
 */
const OPEN_TTL_DEFAULT_MS = 15 * 60 * 1000;
const OPEN_TTL_MIN_MS = 60 * 1000;
const OPEN_TTL_MAX_MS = 24 * 60 * 60 * 1000;

export function resolveOrderChangeOpenTtlMs(): number {
  const raw = Number(process.env.OL_ORDER_CHANGE_OPEN_TTL_MS);
  if (!Number.isFinite(raw) || raw <= 0) {
    return OPEN_TTL_DEFAULT_MS;
  }
  return Math.trunc(Math.min(Math.max(raw, OPEN_TTL_MIN_MS), OPEN_TTL_MAX_MS));
}
