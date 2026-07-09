/**
 * Registration Rate Limited Exception
 *
 * Thrown when a registration attempt exceeds the configured rate limit for
 * the requesting IP while demo mode is enabled (#1469).
 *
 * @module libs/core/src/users/domain/exceptions
 */

export class RegistrationRateLimitedException extends Error {
  constructor() {
    super('Too many registration attempts. Please try again later.');
    this.name = 'RegistrationRateLimitedException';
    Error.captureStackTrace(this, this.constructor);
  }
}
