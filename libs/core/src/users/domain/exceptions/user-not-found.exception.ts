/**
 * User Not Found Exception
 *
 * Thrown when a user lookup by ID or username yields no result.
 *
 * @module libs/core/src/users/domain/exceptions
 */

export class UserNotFoundException extends Error {
  constructor(identifier: string) {
    super(`User not found: ${identifier}`);
    this.name = 'UserNotFoundException';
    Error.captureStackTrace(this, this.constructor);
  }
}
