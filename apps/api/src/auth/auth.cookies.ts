/**
 * Auth Cookie Helpers
 *
 * Shapes the refresh + CSRF cookies set on `/auth/login`, rotated on
 * `/auth/refresh`, and cleared on `/auth/logout`. The single source
 * of truth for cookie names, paths, and SameSite mode — controllers
 * and tests both consume these constants so the contract drift would
 * be visible in the diff.
 *
 * @module apps/api/src/auth
 */
import { randomBytes } from 'crypto';
import type { CookieOptions, Response } from 'express';
import { REFRESH_TOKEN_TTL_SECONDS } from './refresh-token.types';

export const REFRESH_COOKIE_NAME = 'ol_refresh';
export const CSRF_COOKIE_NAME = 'ol_csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';
export const AUTH_COOKIE_PATH = '/auth';

const isProd = (): boolean => process.env.NODE_ENV === 'production';

// Read the SameSite policy from env so cross-origin prod deploys
// (FE on app.example.com, API on api.example.com) can opt down to
// 'lax' explicitly without code changes — the cookie would otherwise
// be silently dropped on every /auth/refresh from a different origin.
// Defaults: 'strict' in prod, 'lax' in dev/test. 'none' requires
// `Secure` per the CORS spec; we don't auto-add it because operators
// running 'none' deserve to see the explicit error if their TLS chain
// is missing.
function resolveSameSite(): 'strict' | 'lax' | 'none' {
  const raw = process.env.OL_COOKIE_SAMESITE?.toLowerCase();
  if (raw === 'strict' || raw === 'lax' || raw === 'none') return raw;
  return isProd() ? 'strict' : 'lax';
}

function refreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: isProd(),
    sameSite: resolveSameSite(),
    path: AUTH_COOKIE_PATH,
    maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
  };
}

function csrfCookieOptions(): CookieOptions {
  // Non-HttpOnly so the SPA can mirror it into X-CSRF-Token.
  return {
    httpOnly: false,
    secure: isProd(),
    sameSite: resolveSameSite(),
    path: AUTH_COOKIE_PATH,
    maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
  };
}

export function setRefreshCookie(res: Response, rawToken: string): void {
  res.cookie(REFRESH_COOKIE_NAME, rawToken, refreshCookieOptions());
}

export function setCsrfCookie(res: Response): string {
  const csrf = randomBytes(32).toString('hex');
  res.cookie(CSRF_COOKIE_NAME, csrf, csrfCookieOptions());
  return csrf;
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: AUTH_COOKIE_PATH });
  res.clearCookie(CSRF_COOKIE_NAME, { path: AUTH_COOKIE_PATH });
}
