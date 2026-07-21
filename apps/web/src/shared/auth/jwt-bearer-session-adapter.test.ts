import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createJwtBearerSessionAdapter } from './jwt-bearer-session-adapter';
import { ANONYMOUS_SESSION } from './session.types';

const BASE_URL = 'http://localhost:3000';

interface MockResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

function makeResponse(status: number, body: unknown): MockResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  };
}

beforeEach(() => {
  // Clear cookies between tests.
  document.cookie.split(';').forEach((c) => {
    document.cookie = c.trim().split('=')[0] + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('JwtBearerSessionAdapter', () => {
  describe('persistSession + getAccessToken', () => {
    it('holds the access token in memory after persistSession', async () => {
      const fetchFn = vi.fn();
      const adapter = createJwtBearerSessionAdapter({
        baseUrl: BASE_URL,
        fetchFn: fetchFn as unknown as typeof fetch,
      });

      await adapter.persistSession('memory-token');

      expect(await adapter.getAccessToken()).toBe('memory-token');
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('does NOT touch localStorage on persistSession', async () => {
      const adapter = createJwtBearerSessionAdapter({ baseUrl: BASE_URL });
      await adapter.persistSession('private-token');

      // Hard assertion: no key in localStorage should leak the token.
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        expect(localStorage.getItem(key ?? '')).not.toContain('private-token');
      }
    });
  });

  describe('refresh', () => {
    it('returns null and clears the in-memory token when /auth/refresh rejects', async () => {
      const fetchFn = vi.fn().mockResolvedValue(makeResponse(401, {}));
      const adapter = createJwtBearerSessionAdapter({
        baseUrl: BASE_URL,
        fetchFn: fetchFn as unknown as typeof fetch,
      });
      await adapter.persistSession('stale-token');

      const result = await adapter.refresh?.();

      expect(result).toBeNull();
      expect(await adapter.getAccessToken()).toBeNull(); // memory wiped on refresh failure
    });

    it('returns the new token and primes the memory cache on success', async () => {
      const fetchFn = vi
        .fn()
        .mockResolvedValueOnce(makeResponse(200, { access_token: 'rotated-token' }));
      const adapter = createJwtBearerSessionAdapter({
        baseUrl: BASE_URL,
        fetchFn: fetchFn as unknown as typeof fetch,
      });

      const result = await adapter.refresh?.();

      expect(result).toBe('rotated-token');
      expect(await adapter.getAccessToken()).toBe('rotated-token');
    });

    it('dedupes concurrent refresh calls (single network round-trip)', async () => {
      let resolveResponse: (value: MockResponse) => void;
      const fetchFn = vi.fn().mockReturnValue(
        new Promise<MockResponse>((resolve) => {
          resolveResponse = resolve;
        }),
      );
      const adapter = createJwtBearerSessionAdapter({
        baseUrl: BASE_URL,
        fetchFn: fetchFn as unknown as typeof fetch,
      });

      // Fire four concurrent refreshes; they all share one fetch.
      const [a, b, c, d] = [
        adapter.refresh?.(),
        adapter.refresh?.(),
        adapter.refresh?.(),
        adapter.refresh?.(),
      ];

      expect(fetchFn).toHaveBeenCalledTimes(1);

      // Resolve the single network call.
      resolveResponse!(makeResponse(200, { access_token: 'shared-token' }));

      const results = await Promise.all([a, b, c, d]);
      expect(results).toEqual([
        'shared-token',
        'shared-token',
        'shared-token',
        'shared-token',
      ]);
    });

    it('sends X-CSRF-Token header when ol_csrf cookie is present', async () => {
      document.cookie = 'ol_csrf=csrf-value-from-cookie; path=/';
      const fetchFn = vi
        .fn()
        .mockResolvedValue(makeResponse(200, { access_token: 'tok' }));
      const adapter = createJwtBearerSessionAdapter({
        baseUrl: BASE_URL,
        fetchFn: fetchFn as unknown as typeof fetch,
      });

      await adapter.refresh?.();

      const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(headers['X-CSRF-Token']).toBe('csrf-value-from-cookie');
      expect(init.credentials).toBe('include');
    });
  });

  describe('getAccessToken triggers refresh when memory empty', () => {
    it('returns the freshly-refreshed token', async () => {
      const fetchFn = vi
        .fn()
        .mockResolvedValueOnce(makeResponse(200, { access_token: 'from-refresh' }));
      const adapter = createJwtBearerSessionAdapter({
        baseUrl: BASE_URL,
        fetchFn: fetchFn as unknown as typeof fetch,
      });

      const token = await adapter.getAccessToken();

      expect(token).toBe('from-refresh');
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });

    it('returns null when refresh fails', async () => {
      const fetchFn = vi.fn().mockResolvedValue(makeResponse(401, {}));
      const adapter = createJwtBearerSessionAdapter({
        baseUrl: BASE_URL,
        fetchFn: fetchFn as unknown as typeof fetch,
      });

      expect(await adapter.getAccessToken()).toBeNull();
    });
  });

  describe('getSession', () => {
    it('returns ANONYMOUS_SESSION when refresh produces no token', async () => {
      const fetchFn = vi.fn().mockResolvedValue(makeResponse(401, {}));
      const adapter = createJwtBearerSessionAdapter({
        baseUrl: BASE_URL,
        fetchFn: fetchFn as unknown as typeof fetch,
      });

      expect(await adapter.getSession()).toEqual(ANONYMOUS_SESSION);
    });

    it('returns authenticated session when refresh succeeds and /auth/me responds', async () => {
      const fetchFn = vi
        .fn()
        .mockResolvedValueOnce(makeResponse(200, { access_token: 'auth-token' }))
        .mockResolvedValueOnce(
          makeResponse(200, {
            id: 'user_1',
            username: 'admin',
            email: 'admin@example.com',
            role: 'admin',
            permissions: ['connections:read'],
          }),
        );
      const adapter = createJwtBearerSessionAdapter({
        baseUrl: BASE_URL,
        fetchFn: fetchFn as unknown as typeof fetch,
      });

      const session = await adapter.getSession();

      expect(session).toEqual({
        status: 'authenticated',
        accessToken: 'auth-token',
        user: {
          id: 'user_1',
          username: 'admin',
          email: 'admin@example.com',
          role: 'admin',
          permissions: ['connections:read'],
          // Default-on (#1743): the /auth/me mock omits the field, so the
          // adapter fills it in as consent granted.
          analyticsConsent: true,
        },
      });
    });
  });

  describe('clearSession', () => {
    it('wipes the in-memory token and calls /auth/logout', async () => {
      const fetchFn = vi.fn().mockResolvedValue(makeResponse(204, {}));
      const adapter = createJwtBearerSessionAdapter({
        baseUrl: BASE_URL,
        fetchFn: fetchFn as unknown as typeof fetch,
      });
      await adapter.persistSession('token-to-clear');

      await adapter.clearSession();

      const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://localhost:3000/v1/auth/logout');
      expect(init.method).toBe('POST');
      expect(init.credentials).toBe('include');

      // After clearSession the in-memory token is gone — subsequent
      // getAccessToken triggers a refresh, which itself fails here.
      fetchFn.mockResolvedValueOnce(makeResponse(401, {}));
      expect(await adapter.getAccessToken()).toBeNull();
    });
  });
});
