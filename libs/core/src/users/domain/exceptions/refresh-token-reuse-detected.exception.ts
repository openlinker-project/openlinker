/**
 * Refresh Token Reuse Detected Exception
 *
 * Thrown by `RefreshTokenService.rotate` when a previously-revoked
 * refresh token is presented at `/auth/refresh`. The exception is
 * thrown only AFTER the rotation chain has been wiped via
 * `revokeChain` — see #710 for the threat model.
 *
 * @module libs/core/src/users/domain/exceptions
 */

export class RefreshTokenReuseDetectedException extends Error {
  constructor() {
    super('Refresh token reuse detected; session terminated.');
    this.name = 'RefreshTokenReuseDetectedException';
    Error.captureStackTrace(this, this.constructor);
  }
}
