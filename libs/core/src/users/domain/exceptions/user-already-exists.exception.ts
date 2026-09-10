/**
 * User Already Exists Exception
 *
 * Thrown when a registration attempt uses a username or email that is
 * already taken by an existing account (pending or active).
 *
 * The message is deliberately generic and never names which field (username
 * or email) collided, nor the submitted value — that surfaces to HTTP
 * clients verbatim (see `AuthController.register`'s catch block) and would
 * otherwise let an unauthenticated caller enumerate registered usernames or
 * emails one guess at a time (#3156). The colliding identifier is still
 * available on `identifier` for server-side logging only — never read it
 * into a response.
 *
 * @module libs/core/src/users/domain/exceptions
 */

export class UserAlreadyExistsException extends Error {
  constructor(public readonly identifier: string) {
    super('Username or email is already in use');
    this.name = 'UserAlreadyExistsException';
    Error.captureStackTrace(this, this.constructor);
  }
}
