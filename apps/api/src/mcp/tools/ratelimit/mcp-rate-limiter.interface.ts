/**
 * MCP Rate Limiter Interface
 *
 * Per-token abuse cap for the MCP tool surface (#1487). Two independent
 * limits, both keyed on the MCP token id (never the raw token):
 *
 *   - a rolling REQUEST-RATE window (N calls per window), and
 *   - a CONCURRENCY cap (N simultaneously in-flight calls).
 *
 * Concurrency is what an autonomous agent stuck in a loop actually exhausts;
 * the rate window is what a merely chatty one does. They fail differently, so
 * both are enforced.
 *
 * @module apps/api/src/mcp/tools/ratelimit
 */

/**
 * Outcome of an acquire attempt.
 *
 * `release()` is ALWAYS returned — including when `allowed` is false — so the
 * caller's `finally` block never has to branch. Releasing a slot that was
 * never taken is a no-op.
 */
export interface McpRateLimitLease {
  readonly allowed: boolean;
  /** Populated only when `allowed` is false; agent-facing copy. */
  readonly reason?: string;
  release(): Promise<void>;
}

export const MCP_RATE_LIMITER_TOKEN = Symbol('IMcpRateLimiter');

export interface IMcpRateLimiter {
  /**
   * Attempt to claim a slot for one tool call.
   *
   * Never throws: a Redis outage resolves to `allowed: true` (fail open).
   * The limiter is abuse mitigation, not an authorization control — auth is
   * already enforced upstream by `requireBearerAuth`, so failing closed would
   * trade a real availability loss for a speculative abuse window.
   */
  acquire(mcpTokenId: string): Promise<McpRateLimitLease>;
}
