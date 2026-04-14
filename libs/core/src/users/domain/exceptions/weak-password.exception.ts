/**
 * Weak Password Exception
 *
 * Thrown when a supplied password fails domain password-strength rules.
 *
 * @module libs/core/src/users/domain/exceptions
 */

export class WeakPasswordException extends Error {
  constructor(message = 'Password does not meet the minimum requirements') {
    super(message);
    this.name = 'WeakPasswordException';
    Error.captureStackTrace(this, this.constructor);
  }
}
