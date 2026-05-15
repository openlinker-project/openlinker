/**
 * Refresh Token Service Types
 *
 * Module-local types and constants for the refresh-token rotation flow
 * (#710). The TTL is fixed in code rather than env because it's a
 * security-policy default — sites that need a different TTL should
 * change it in a follow-up PR with the threat-model implication
 * spelled out. The result shapes here are the public contract of
 * `IRefreshTokenService` and live in this file (not the interface
 * file) per `engineering-standards.md § Type Definitions in Separate
 * Files`.
 *
 * @module apps/api/src/auth
 */

export const REFRESH_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const REFRESH_TOKEN_TTL_SECONDS = REFRESH_TOKEN_TTL_MS / 1000;

export interface IssuedRefreshToken {
  rawToken: string;
  expiresAt: Date;
}

export interface RotatedRefreshToken {
  userId: string;
  rawToken: string;
  expiresAt: Date;
}
