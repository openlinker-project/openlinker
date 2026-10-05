/**
 * User Not Awaiting First Sign-In Exception
 *
 * Thrown when an admin tries to re-issue a one-time password for an account
 * that is not in the forced-change state (#3456). Re-issuing for an account that
 * has already replaced its password would silently overwrite a credential the
 * person chose, so it is refused.
 *
 * @module libs/core/src/users/domain/exceptions
 */

export class UserNotAwaitingFirstSignInException extends Error {
  constructor(userId: string) {
    super(`User has already set their own password: ${userId}`);
    this.name = 'UserNotAwaitingFirstSignInException';
    Error.captureStackTrace(this, this.constructor);
  }
}
