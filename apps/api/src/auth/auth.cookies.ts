/**
 * Auth Cookie Helpers
 *
 * Shapes the refresh + CSRF cookies set on `/v1/auth/login`, rotated on
 * `/v1/auth/refresh`, and cleared on `/v1/auth/logout`. The single source
 * of truth for cookie names, paths, and SameSite mode — controllers
 * and tests both consume these constants so the contract drift would
 * be visible in the diff.
 *
 * @module apps/api/src/auth
 */
import { randomBytes } from 'crypto';
import type { CookieOptions, Response } from 'express';
import { API_VERSION_LABEL } from '../app-info/app-info.types';
import { REFRESH_TOKEN_TTL_SECONDS } from './refresh-token.types';

export const REFRESH_COOKIE_NAME = 'ol_refresh';
export const CSRF_COOKIE_NAME = 'ol_csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';

// Refresh cookie is HttpOnly and only consumed by /v1/auth/refresh +
// /v1/auth/logout, so scoping it to the versioned auth subtree keeps it out
// of every unrelated request. Derived from API_VERSION_LABEL — the same
// source main.ts feeds enableVersioning() — because RFC 6265 §5.1.4 only
// sends a cookie when its Path prefixes the request path on / boundaries:
// a literal '/auth' is NOT a prefix of '/v1/auth/refresh', so the browser
// silently dropped the cookie from every refresh after the /v1 migration
// (#1133) and each page reload logged the user out. See #1327.
export const REFRESH_COOKIE_PATH = `/${API_VERSION_LABEL}/auth`;

// Pre-versioning scope: ol_refresh lived here until #1327, and ol_csrf until
// #748. Only used to clear those stale copies out of returning browsers.
const LEGACY_AUTH_COOKIE_PATH = '/auth';

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

// Read an explicit cookie Domain from env for split-subdomain deploys (SPA on
// app.example.com, API on api.example.com). Without a Domain the cookies are
// host-only, so the SPA host can't read the non-HttpOnly ol_csrf cookie set by
// the API host via document.cookie — the X-CSRF-Token mirror comes up empty and
// every silent /auth/refresh after a full-page navigation (e.g. the OAuth
// bounce back from allegro.pl) is rejected, logging the user out. Setting
// OL_COOKIE_DOMAIN=.example.com scopes both cookies to the shared parent domain
// so the SPA subdomain can read ol_csrf. Unset ⇒ host-only (unchanged). See
// #1725. A Domain-scoped cookie can only be cleared with the same Domain, so
// this value MUST also be threaded through every clearCookie() below.
function resolveCookieDomain(): string | undefined {
  const raw = process.env.OL_COOKIE_DOMAIN?.trim();
  return raw && raw.length > 0 ? raw : undefined;
}

function domainOption(): Pick<CookieOptions, 'domain'> | undefined {
  const domain = resolveCookieDomain();
  return domain ? { domain } : undefined;
}

function refreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: isProd(),
    sameSite: resolveSameSite(),
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
    ...domainOption(),
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
    ...domainOption(),
  };
}

export function setRefreshCookie(res: Response, rawToken: string): void {
  // Migration cleanup: drop the stale ol_refresh left at /auth from the
  // pre-#1327 window before issuing the /v1/auth-scoped one. The stale copy
  // is never sent to /v1/auth/* (that was the bug), but it holds a live,
  // unrevoked token that would otherwise sit in the jar for its full TTL.
  // Has to run on every login/refresh — affected users never reach logout
  // while they're being silently bounced to /auth/login.
  res.clearCookie(REFRESH_COOKIE_NAME, { path: LEGACY_AUTH_COOKIE_PATH });
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
  res.clearCookie(CSRF_COOKIE_NAME, { path: LEGACY_AUTH_COOKIE_PATH });
  res.cookie(CSRF_COOKIE_NAME, csrf, csrfCookieOptions());
  return csrf;
}

export function clearAuthCookies(res: Response): void {
  // Current cookies may carry a Domain (OL_COOKIE_DOMAIN); a Domain-scoped
  // cookie only clears when the clear carries the same Domain. The legacy
  // /auth clears below stay host-only — those copies predate #1725 and were
  // never Domain-scoped.
  res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH, ...domainOption() });
  res.clearCookie(CSRF_COOKIE_NAME, { path: CSRF_COOKIE_PATH, ...domainOption() });
  // Migration cleanup: ol_csrf was previously set at /auth (#748), ol_refresh
  // until #1327. Clear those copies too so stale cookies from the buggy
  // windows don't linger (csrf could even shadow the new /-scoped value).
  res.clearCookie(CSRF_COOKIE_NAME, { path: LEGACY_AUTH_COOKIE_PATH });
  res.clearCookie(REFRESH_COOKIE_NAME, { path: LEGACY_AUTH_COOKIE_PATH });
}
