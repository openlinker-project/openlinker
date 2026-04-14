/**
 * Invalid Password Reset Token Exception
 *
 * Thrown when a password reset token is unknown, expired, or already used.
 *
 * @module libs/core/src/users/domain/exceptions
 */

export class InvalidPasswordResetTokenException extends Error {
  constructor() {
    super('Invalid or expired password reset token');
    this.name = 'InvalidPasswordResetTokenException';
    Error.captureStackTrace(this, this.constructor);
  }
}
