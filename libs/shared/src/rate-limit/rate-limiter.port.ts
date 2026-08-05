/**
 * Rate Limiter Port
 *
 * Contract for the per-connection outbound pacing + concurrency-cap
 * mechanism (#1810). One instance guards one connection's outbound traffic.
 *
 * @module libs/shared/src/rate-limit
 */
import type {
  ConnectionRateLimit,
  RateLimitPriority,
  RateLimitRelease,
  RateLimitStatus,
} from './rate-limiter.types';

export interface RateLimiterPort {
  /**
   * Wait for a slot, honouring both the minimum-interval spacing
   * (`requestsPerMinute`) and the concurrency cap (`maxConcurrent`) in
   * `policy`. `policy` is re-read on every call — only in-flight/bucket
   * state is retained between calls, never the policy itself, so lowering
   * a cap takes effect on the very next `acquire()`.
   *
   * Resolves with a {@link RateLimitRelease} the caller MUST invoke exactly
   * once (idempotent if called more than once) when the guarded request
   * completes, in a `finally` so a throw still releases the slot.
   *
   * Rejects with `RateLimitTimeoutError` if the wait exceeds the internal
   * bound (`MAX_TOTAL_WAIT_MS`), or `RateLimitAbortedError` if `signal` is
   * aborted while queued.
   */
  acquire(
    policy: ConnectionRateLimit,
    priority?: RateLimitPriority,
    signal?: AbortSignal
  ): Promise<RateLimitRelease>;

  /**
   * Feed a provider-reported `Retry-After` delay (ms) into the pacing gate,
   * pushing the next-available time forward. Read-only informational input
   * — this does not itself retry anything.
   */
  noteRetryAfter(delayMs: number): void;

  /** Current in-flight/queue depth, for the pure observability read. */
  getStatus(): RateLimitStatus;
}
