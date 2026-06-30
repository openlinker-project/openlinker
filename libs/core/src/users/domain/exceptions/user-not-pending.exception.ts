/**
 * User Not Pending Exception
 *
 * Thrown when an admin attempts to approve or reject a user whose status
 * is not `pending` (e.g. already active or deactivated).
 *
 * @module libs/core/src/users/domain/exceptions
 */

export class UserNotPendingException extends Error {
  constructor(userId: string) {
    super(`User is not pending approval: ${userId}`);
    this.name = 'UserNotPendingException';
    Error.captureStackTrace(this, this.constructor);
  }
}
