/**
 * Rate Limiter Errors
 *
 * Distinguishable rejection reasons for a queued `acquire()` call, so a
 * caller (or its own retry/circuit-breaker logic) can tell "gave up
 * waiting" apart from "caller cancelled" apart from an ordinary I/O error.
 *
 * @module libs/shared/src/rate-limit
 */
export class RateLimitTimeoutError extends Error {
  constructor(waitedMs: number) {
    super(`Timed out after waiting ${waitedMs}ms for a rate-limit slot`);
    this.name = 'RateLimitTimeoutError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class RateLimitAbortedError extends Error {
  constructor() {
    super('Rate-limit wait was aborted');
    this.name = 'RateLimitAbortedError';
    Error.captureStackTrace(this, this.constructor);
  }
}
