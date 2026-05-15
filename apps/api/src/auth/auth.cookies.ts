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

// Refresh cookie is HttpOnly and only consumed by /auth/refresh + /auth/logout,
// so scoping it to /auth keeps it out of every unrelated request.
const REFRESH_COOKIE_PATH = '/auth';

// CSRF cookie is non-HttpOnly so the SPA can read it via document.cookie and
// mirror it into X-CSRF-Token. document.cookie only exposes cookies whose
// Path prefixes the current document URL, so this MUST stay at '/' — otherwise
// readCsrfCookie() returns null on every route outside /auth/* and silent
// refresh breaks after a full-page reload (e.g. OAuth bounce back from
// allegro.pl). See #748.
const CSRF_COOKIE_PATH = '/';

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
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
  };
}

function csrfCookieOptions(): CookieOptions {
  // Non-HttpOnly so the SPA can mirror it into X-CSRF-Token.
  return {
    httpOnly: false,
    secure: isProd(),
    sameSite: resolveSameSite(),
    path: CSRF_COOKIE_PATH,
    maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
  };
}

export function setRefreshCookie(res: Response, rawToken: string): void {
  res.cookie(REFRESH_COOKIE_NAME, rawToken, refreshCookieOptions());
}

export function setCsrfCookie(res: Response): string {
  const csrf = randomBytes(32).toString('hex');
  // Migration cleanup: drop any stale ol_csrf left over at /auth from the
  // pre-#748 window before re-issuing the new /-scoped one. Without this,
  // /auth/refresh receives Cookie: ol_csrf=<stale>; ol_csrf=<new> (longer
  // path first per RFC 6265 §5.4), cookie-parser keeps the first value, and
  // CsrfGuard compares <stale> against the SPA's mirrored <new> → 403. Has
  // to run on every successful login/refresh — clearAuthCookies (logout
  // only) isn't enough because affected users never reach logout while
  // they're being silently bounced to /auth/login.
  res.clearCookie(CSRF_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
  res.cookie(CSRF_COOKIE_NAME, csrf, csrfCookieOptions());
  return csrf;
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
  res.clearCookie(CSRF_COOKIE_NAME, { path: CSRF_COOKIE_PATH });
  // Migration cleanup: ol_csrf was previously set at /auth (#748). Clear that
  // copy too so stale cookies from the buggy window don't shadow the new one.
  res.clearCookie(CSRF_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
}
