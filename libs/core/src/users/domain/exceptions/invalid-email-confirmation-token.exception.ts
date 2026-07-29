/**
 * Invalid Email Confirmation Token Exception
 *
 * Thrown when an email confirmation token is unknown, expired, or already used.
 *
 * @module libs/core/src/users/domain/exceptions
 */

export class InvalidEmailConfirmationTokenException extends Error {
  constructor() {
    super('Invalid or expired email confirmation token');
    this.name = 'InvalidEmailConfirmationTokenException';
    Error.captureStackTrace(this, this.constructor);
  }
}
