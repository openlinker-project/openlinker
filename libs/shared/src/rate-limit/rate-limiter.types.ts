/**
 * Rate Limiter Types
 *
 * Platform-neutral shapes for the per-connection outbound rate-limiting
 * mechanism (#1810). `ConnectionRateLimit` mirrors the shape stamped on
 * `Connection.config.rateLimit` in `@openlinker/core/identifier-mapping` —
 * duplicated here (not imported) so this package stays free of any
 * dependency on CORE domain types; callers pass the policy in structurally.
 *
 * @module libs/shared/src/rate-limit
 */

/**
 * A queued `acquire()` call is classified so the limiter can prefer draining
 * interactive callers (an operator's live HTTP request) over background
 * callers (a worker job) without maintaining two separate additive pools.
 */
export const RateLimitPriorityValues = ['background', 'interactive'] as const;
export type RateLimitPriority = (typeof RateLimitPriorityValues)[number];

export interface ConnectionRateLimit {
  /** Smooth-paced cap (minimum-interval spacing). Undefined = unlimited. */
  requestsPerMinute?: number;
  /** Max simultaneous in-flight requests. Undefined = unlimited. */
  maxConcurrent?: number;
}

export interface RateLimitStatus {
  requestsPerMinute?: number;
  maxConcurrent?: number;
  inFlight: number;
  queued: number;
  lastAcquiredAt: Date | null;
}

/** Call to release a previously-acquired slot. Idempotent. */
export type RateLimitRelease = () => void;
