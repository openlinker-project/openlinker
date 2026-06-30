/**
 * Cannot Self-Modify Exception
 *
 * Thrown when an admin attempts to deactivate, demote, or delete their own
 * account. Prevents self-lockout from the admin surface.
 *
 * @module libs/core/src/users/domain/exceptions
 */
export class CannotSelfModifyException extends Error {
  constructor() {
    super('Admins cannot modify their own account status or role');
    this.name = 'CannotSelfModifyException';
    Error.captureStackTrace(this, this.constructor);
  }
}
