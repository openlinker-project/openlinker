/**
 * Rate Limit Module Exports
 *
 * Public API for the shared per-connection outbound rate-limiting
 * mechanism (#1810). Plugins never import this directly for their own
 * bespoke policy — they only ever see it through `HostServices.http`
 * (`@openlinker/shared/http`), which is what makes the mechanism
 * enforceable rather than a convention to remember.
 *
 * @module libs/shared/src/rate-limit
 */
export type {
  ConnectionRateLimit,
  RateLimitPriority,
  RateLimitRelease,
  RateLimitStatus,
} from './rate-limiter.types';
export { RateLimitPriorityValues } from './rate-limiter.types';
export { RateLimitTimeoutError, RateLimitAbortedError } from './rate-limiter.errors';
export type { RateLimiterPort } from './rate-limiter.port';
export { RateLimiter, MAX_TOTAL_WAIT_MS } from './rate-limiter';
export type { RateLimiterDeps } from './rate-limiter';
export { createRateLimiterRegistry } from './rate-limiter-registry';
export type { RateLimiterRegistry } from './rate-limiter-registry';
export {
  runWithPriority,
  getCurrentPriority,
  getCurrentRateLimitSignal,
} from './priority-context';
export type { RateLimitPriorityContext } from './priority-context';
