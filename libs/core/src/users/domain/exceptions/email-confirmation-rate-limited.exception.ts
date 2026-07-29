/**
 * Email Confirmation Rate Limited Exception
 *
 * Thrown when a resend-confirmation request exceeds the configured rate
 * limit for the requesting IP while demo mode is enabled (#1655 review
 * finding — mirrors RegistrationRateLimitedException's rationale and
 * enforcement shape for the sibling resend-confirmation endpoint).
 *
 * @module libs/core/src/users/domain/exceptions
 */

export class EmailConfirmationRateLimitedException extends Error {
  constructor() {
    super('Too many confirmation email requests. Please try again later.');
    this.name = 'EmailConfirmationRateLimitedException';
    Error.captureStackTrace(this, this.constructor);
  }
}
