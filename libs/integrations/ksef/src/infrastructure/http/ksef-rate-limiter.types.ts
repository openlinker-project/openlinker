/**
 * KSeF Rate Limiter Types
 *
 * Type surface for the proactive, client-side request pacer (#1594). KSeF 2.0
 * enforces per-context `(seller NIP, source IP)` per-hour ceilings on the three
 * online-session write endpoints; the pacer self-throttles a bulk run against
 * those documented ceilings rather than relying solely on reactive
 * 429/Retry-After backoff.
 *
 * Kept in a dedicated `.types.ts` file per engineering-standards "Type
 * Definitions in Separate Files"; the `as const` + union pattern (no enums) is
 * the project default for enumerated values.
 *
 * @module libs/integrations/ksef/src/infrastructure/http
 */

/**
 * The three rate-limited KSeF online-session write endpoints, keyed by neutral
 * category. Reads (`GET /sessions/{ref}`, status/UPO polls) and the auth
 * handshake are NOT in the documented ceilings and are never paced.
 */
export const KsefRateLimitCategoryValues = [
  'session-open', // POST /sessions/online
  'invoice-submit', // POST /sessions/online/{ref}/invoices
  'session-close', // POST /sessions/online/{ref}/close
] as const;

export type KsefRateLimitCategory = (typeof KsefRateLimitCategoryValues)[number];

/**
 * Per-category configured ceiling. `perHour` is the effective sustained rate the
 * pacer enforces (documented KSeF ceiling minus reserved headroom); it doubles
 * as the token-bucket capacity, so a burst up to `perHour` requests is admitted
 * immediately and steady-state traffic then paces at `perHour` per rolling hour.
 */
export interface KsefRateLimitConfig {
  perHour: number;
}

export type KsefRateLimiterConfig = Record<KsefRateLimitCategory, KsefRateLimitConfig>;

/**
 * Injectable time source so pacing is deterministic under test (no real sleeps).
 * `now` returns epoch milliseconds; `sleep` resolves after the given delay.
 */
export interface KsefRateLimiterClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}
