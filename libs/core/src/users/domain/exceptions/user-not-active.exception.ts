/**
 * User Not Active Exception
 *
 * Thrown when an admin attempts to deactivate a user whose status is not
 * `active` (e.g. already deactivated or still pending approval).
 *
 * @module libs/core/src/users/domain/exceptions
 */

export class UserNotActiveException extends Error {
  constructor(userId: string) {
    super(`User is not active: ${userId}`);
    this.name = 'UserNotActiveException';
    Error.captureStackTrace(this, this.constructor);
  }
}
