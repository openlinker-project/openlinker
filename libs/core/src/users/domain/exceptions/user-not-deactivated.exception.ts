/**
 * User Not Deactivated Exception
 *
 * Thrown when an admin attempts to reactivate a user whose status is not
 * `deactivated` (e.g. already active or still pending approval).
 *
 * @module libs/core/src/users/domain/exceptions
 */

export class UserNotDeactivatedException extends Error {
  constructor(userId: string) {
    super(`User is not deactivated: ${userId}`);
    this.name = 'UserNotDeactivatedException';
    Error.captureStackTrace(this, this.constructor);
  }
}
