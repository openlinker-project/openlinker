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
  REFRESH_COOKIE_NAME,
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
