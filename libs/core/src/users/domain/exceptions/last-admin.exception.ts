/**
 * Last Admin Exception
 *
 * Thrown when an operation would remove or deactivate the last admin in the
 * system, which would lock everyone out of the admin surface.
 *
 * @module libs/core/src/users/domain/exceptions
 */
export class LastAdminException extends Error {
  constructor() {
    super('Cannot remove or deactivate the last admin account');
    this.name = 'LastAdminException';
    Error.captureStackTrace(this, this.constructor);
  }
}
