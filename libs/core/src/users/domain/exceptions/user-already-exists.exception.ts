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
 * emails one guess at a time (#3156).
 *
 * `identifier` retains the colliding value as structured context for a
 * debugger or an error sink. Nothing in this codebase logs it and nothing
 * may read it into a response: `RegistrationService` deliberately logs only
 * WHICH field collided, because `POST /auth/register` is `@Public()` and
 * unthrottled outside demo mode, so the value is attacker-supplied.
 *
 * Scope limit, stated so it is not mistaken for a closed hole: genericising
 * the message does NOT close user enumeration. `register` still answers 409
 * for a taken identifier and 201 for a free one, which is by itself a
 * sufficient oracle (#3156 review). Closing it means always answering 201
 * and notifying by email — the `forgotPassword` shape — which is tracked on
 * #3156, not done here.
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
