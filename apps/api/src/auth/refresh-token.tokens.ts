/**
 * Refresh Token Service DI Tokens
 *
 * Symbol token(s) for the refresh-token rotation flow (#710). Split out
 * of `refresh-token.types.ts` so the tokens file holds only Symbol
 * declarations — mirrors the core-context convention from
 * `engineering-standards.md § Symbol DI Token Re-export Convention`.
 *
 * @module apps/api/src/auth
 */

export const REFRESH_TOKEN_SERVICE_TOKEN = Symbol('IRefreshTokenService');
