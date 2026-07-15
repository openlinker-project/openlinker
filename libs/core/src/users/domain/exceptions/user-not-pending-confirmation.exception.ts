/**
 * User Not Pending Confirmation Exception
 *
 * Thrown when an email confirmation token resolves to a user whose status
 * is not `pending_confirmation` (e.g. already active) — the account has
 * already been confirmed or was never in that state.
 *
 * @module libs/core/src/users/domain/exceptions
 */

export class UserNotPendingConfirmationException extends Error {
  constructor(userId: string) {
    super(`User is not pending email confirmation: ${userId}`);
    this.name = 'UserNotPendingConfirmationException';
    Error.captureStackTrace(this, this.constructor);
  }
}
