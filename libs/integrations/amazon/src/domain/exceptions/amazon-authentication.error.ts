/**
 * Amazon Authentication Error
 *
 * Login with Amazon refused to mint an access token from the stored
 * credentials (`invalid_grant`, `invalid_client`, `unauthorized_client`): the
 * refresh token was revoked or expired, or the client id / secret is wrong or
 * was rotated. Retrying cannot fix it; the auth-failure classifier flips the
 * connection to `needs_reauth` so the operator is asked to re-authorize.
 *
 * @module libs/integrations/amazon/src/domain/exceptions
 */
export class AmazonAuthenticationError extends Error {
  constructor(
    public readonly grantError: string,
    detail?: string,
  ) {
    super(`Login with Amazon refused the credentials (${grantError})` + (detail ? `: ${detail}` : ''));
    this.name = 'AmazonAuthenticationError';
    Error.captureStackTrace(this, this.constructor);
  }
}
