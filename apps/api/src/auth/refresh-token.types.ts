/**
 * Refresh Token Service Types
 *
 * Module-local constants for the refresh-token rotation flow (#710).
 * Refresh-token TTL is fixed in code rather than env because it's a
 * security-policy default — sites that need a different TTL should
 * change it in a follow-up PR with the threat-model implication
 * spelled out.
 *
 * @module apps/api/src/auth
 */

export const REFRESH_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const REFRESH_TOKEN_TTL_SECONDS = REFRESH_TOKEN_TTL_MS / 1000;

export const REFRESH_TOKEN_SERVICE_TOKEN = Symbol('IRefreshTokenService');
