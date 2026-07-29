/**
 * Email Not Confirmed Exception
 *
 * Thrown by login when credentials are otherwise valid but the account is
 * still awaiting email confirmation (`status: 'pending_confirmation'`). The
 * clear, specific message is intentional here — unlike the generic 401 used
 * for wrong-password/unknown-user, the user already proved they know the
 * password, so telling them to check their inbox does not create a new
 * user-enumeration oracle.
 *
 * @module libs/core/src/users/domain/exceptions
 */

export class EmailNotConfirmedException extends Error {
  constructor() {
    super('Please confirm your email address before logging in. Check your inbox for the confirmation link.');
    this.name = 'EmailNotConfirmedException';
    Error.captureStackTrace(this, this.constructor);
  }
}
