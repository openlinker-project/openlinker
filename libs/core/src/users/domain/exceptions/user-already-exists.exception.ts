/**
 * User Already Exists Exception
 *
 * Thrown when a registration attempt uses a username or email that is
 * already taken by an existing account (pending or active).
 *
 * @module libs/core/src/users/domain/exceptions
 */

export class UserAlreadyExistsException extends Error {
  constructor(identifier: string) {
    super(`User already exists: ${identifier}`);
    this.name = 'UserAlreadyExistsException';
    Error.captureStackTrace(this, this.constructor);
  }
}
