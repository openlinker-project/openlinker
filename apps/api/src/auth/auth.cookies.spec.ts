/**
 * Auth Cookie Helpers — unit tests
 *
 * Covers the OL_COOKIE_DOMAIN knob added for split-subdomain deploys (#1725):
 * when set, the Domain attribute is applied to both auth cookies on set + clear;
 * when unset, cookies stay host-only (unchanged behaviour).
 *
 * @module apps/api/src/auth
 */
import type { CookieOptions, Response } from 'express';
import {
  CSRF_COOKIE_NAME,
  CSRF_COOKIE_PATH,
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
  clearAuthCookies,
  setCsrfCookie,
  setRefreshCookie,
} from './auth.cookies';

interface CookieCall {
  name: string;
  value: string;
  options: CookieOptions;
}

interface ClearCall {
  name: string;
  options: CookieOptions;
}

function createResponseSpy(): {
  res: Response;
  cookies: CookieCall[];
  clears: ClearCall[];
} {
  const cookies: CookieCall[] = [];
  const clears: ClearCall[] = [];
  const res = {
    cookie: (name: string, value: string, options: CookieOptions): Response => {
      cookies.push({ name, value, options });
      return res;
    },
    clearCookie: (name: string, options: CookieOptions): Response => {
      clears.push({ name, options });
      return res;
    },
  } as unknown as Response;
  return { res, cookies, clears };
}

describe('auth.cookies', () => {
  const originalDomain = process.env.OL_COOKIE_DOMAIN;

  afterEach(() => {
    if (originalDomain === undefined) {
      delete process.env.OL_COOKIE_DOMAIN;
    } else {
      process.env.OL_COOKIE_DOMAIN = originalDomain;
    }
  });

  describe('when OL_COOKIE_DOMAIN is set', () => {
    beforeEach(() => {
      process.env.OL_COOKIE_DOMAIN = '.example.com';
    });

    it('should apply the Domain attribute to the refresh cookie', () => {
      const { res, cookies } = createResponseSpy();

      setRefreshCookie(res, 'raw-refresh-token');

      const set = cookies.find((c) => c.name === REFRESH_COOKIE_NAME);
      expect(set?.options.domain).toBe('.example.com');
    });

    it('should apply the Domain attribute to the CSRF cookie', () => {
      const { res, cookies } = createResponseSpy();

      setCsrfCookie(res);

      const set = cookies.find((c) => c.name === CSRF_COOKIE_NAME);
      expect(set?.options.domain).toBe('.example.com');
    });

    it('should apply the Domain attribute when clearing the current auth cookies', () => {
      const { res, clears } = createResponseSpy();

      clearAuthCookies(res);

      // Current-path clears carry the Domain; legacy /auth clears stay host-only.
      const refreshCurrent = clears.find(
        (c) => c.name === REFRESH_COOKIE_NAME && c.options.path?.startsWith('/v'),
      );
      const csrfCurrent = clears.find(
        (c) => c.name === CSRF_COOKIE_NAME && c.options.path === '/',
      );
      expect(refreshCurrent?.options.domain).toBe('.example.com');
      expect(csrfCurrent?.options.domain).toBe('.example.com');

      const legacyClears = clears.filter((c) => c.options.path === '/auth');
      expect(legacyClears.length).toBeGreaterThan(0);
      for (const legacy of legacyClears) {
        expect(legacy.options.domain).toBeUndefined();
      }
    });

    // #1998: a browser that logged in before OL_COOKIE_DOMAIN was configured
    // still carries a host-only cookie at the CURRENT path. (name, domain,
    // path) together identify a cookie, so that host-only copy and a fresh
    // Domain-scoped copy coexist as two distinct, simultaneously-valid
    // cookies rather than one overwriting the other — collapsing it back to
    // one requires an explicit host-only clear on every set/clear.
    it('should also clear the host-only identity of the refresh cookie at the current path', () => {
      const { res, clears } = createResponseSpy();

      setRefreshCookie(res, 'raw-refresh-token');

      const hostOnlyClear = clears.find(
        (c) =>
          c.name === REFRESH_COOKIE_NAME &&
          c.options.path === REFRESH_COOKIE_PATH &&
          c.options.domain === undefined,
      );
      expect(hostOnlyClear).toBeDefined();
    });

    it('should also clear the host-only identity of the CSRF cookie at the current path', () => {
      const { res, clears } = createResponseSpy();

      setCsrfCookie(res);

      const hostOnlyClear = clears.find(
        (c) =>
          c.name === CSRF_COOKIE_NAME &&
          c.options.path === CSRF_COOKIE_PATH &&
          c.options.domain === undefined,
      );
      expect(hostOnlyClear).toBeDefined();
    });

    it('should also clear the host-only identity of both cookies on logout', () => {
      const { res, clears } = createResponseSpy();

      clearAuthCookies(res);

      const hostOnlyRefreshClear = clears.find(
        (c) =>
          c.name === REFRESH_COOKIE_NAME &&
          c.options.path === REFRESH_COOKIE_PATH &&
          c.options.domain === undefined,
      );
      const hostOnlyCsrfClear = clears.find(
        (c) =>
          c.name === CSRF_COOKIE_NAME &&
          c.options.path === CSRF_COOKIE_PATH &&
          c.options.domain === undefined,
      );
      expect(hostOnlyRefreshClear).toBeDefined();
      expect(hostOnlyCsrfClear).toBeDefined();
    });
  });

  describe('when OL_COOKIE_DOMAIN is unset', () => {
    beforeEach(() => {
      delete process.env.OL_COOKIE_DOMAIN;
    });

    it('should leave the refresh cookie host-only', () => {
      const { res, cookies } = createResponseSpy();

      setRefreshCookie(res, 'raw-refresh-token');

      const set = cookies.find((c) => c.name === REFRESH_COOKIE_NAME);
      expect(set?.options.domain).toBeUndefined();
    });

    it('should leave the CSRF cookie host-only', () => {
      const { res, cookies } = createResponseSpy();

      setCsrfCookie(res);

      const set = cookies.find((c) => c.name === CSRF_COOKIE_NAME);
      expect(set?.options.domain).toBeUndefined();
    });

    // #1998 follow-up: the extra host-only clear only matters once
    // OL_COOKIE_DOMAIN introduces a Domain-scoped identity to collapse a
    // stale host-only one into — with it unset there's nothing to collapse,
    // so the clear must be skipped rather than firing as a redundant
    // clear-then-immediately-reissue of the same cookie identity.
    it('should not clear the current-path refresh cookie before (re-)issuing it', () => {
      const { res, clears } = createResponseSpy();

      setRefreshCookie(res, 'raw-refresh-token');

      const currentPathClears = clears.filter(
        (c) => c.name === REFRESH_COOKIE_NAME && c.options.path === REFRESH_COOKIE_PATH,
      );
      expect(currentPathClears).toHaveLength(0);
    });

    it('should not clear the current-path CSRF cookie before (re-)issuing it', () => {
      const { res, clears } = createResponseSpy();

      setCsrfCookie(res);

      const currentPathClears = clears.filter(
        (c) => c.name === CSRF_COOKIE_NAME && c.options.path === CSRF_COOKIE_PATH,
      );
      expect(currentPathClears).toHaveLength(0);
    });

    it('should not clear the current-path cookies twice on logout', () => {
      const { res, clears } = createResponseSpy();

      clearAuthCookies(res);

      const refreshCurrentClears = clears.filter(
        (c) => c.name === REFRESH_COOKIE_NAME && c.options.path === REFRESH_COOKIE_PATH,
      );
      const csrfCurrentClears = clears.filter(
        (c) => c.name === CSRF_COOKIE_NAME && c.options.path === CSRF_COOKIE_PATH,
      );
      expect(refreshCurrentClears.length).toBe(1);
      expect(csrfCurrentClears.length).toBe(1);
    });

    it('should leave every clear host-only', () => {
      const { res, clears } = createResponseSpy();

      clearAuthCookies(res);

      for (const clear of clears) {
        expect(clear.options.domain).toBeUndefined();
      }
    });
  });

  describe('OL_COOKIE_DOMAIN with surrounding whitespace', () => {
    it('should trim the value before applying it', () => {
      process.env.OL_COOKIE_DOMAIN = '  .example.com  ';
      const { res, cookies } = createResponseSpy();

      setCsrfCookie(res);

      const set = cookies.find((c) => c.name === CSRF_COOKIE_NAME);
      expect(set?.options.domain).toBe('.example.com');
    });

    it('should treat a whitespace-only value as unset', () => {
      process.env.OL_COOKIE_DOMAIN = '   ';
      const { res, cookies } = createResponseSpy();

      setCsrfCookie(res);

      const set = cookies.find((c) => c.name === CSRF_COOKIE_NAME);
      expect(set?.options.domain).toBeUndefined();
    });
  });
});
