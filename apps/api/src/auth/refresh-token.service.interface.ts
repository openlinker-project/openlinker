/**
 * Refresh Token Service Interface
 *
 * Application-layer contract for the refresh-token rotation flow
 * (#710). Login calls `issue()`; `/auth/refresh` calls `rotate()`;
 * `/auth/logout` calls `revoke()`. Reuse-detection is a `rotate()`
 * implementation concern — callers see only the thrown exception.
 *
 * @module apps/api/src/auth
 */

export interface IssuedRefreshToken {
  rawToken: string;
  expiresAt: Date;
}

export interface RotatedRefreshToken {
  userId: string;
  rawToken: string;
  expiresAt: Date;
}

export interface IRefreshTokenService {
  /**
   * Issue a fresh top-of-chain token. Returns the raw token + expiry
   * (caller sets the cookie). `rotated_from_id` is NULL — this is the
   * login-time issuance path.
   */
  issue(userId: string): Promise<IssuedRefreshToken>;

  /**
   * Rotate the presented token: revoke the predecessor with reason
   * `rotated`, insert a new row with `rotated_from_id = presented.id`,
   * return the new raw token.
   *
   * Throws `UnauthorizedException` if the token is unknown or expired.
   * Throws `RefreshTokenReuseDetectedException` (after revoking the
   * full chain) if the presented token was already revoked.
   */
  rotate(rawToken: string): Promise<RotatedRefreshToken>;

  /** Revoke the current token (logout). No-op if already revoked. */
  revoke(rawToken: string): Promise<void>;
}
