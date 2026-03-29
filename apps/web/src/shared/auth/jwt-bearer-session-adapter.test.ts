import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createJwtBearerSessionAdapter } from './jwt-bearer-session-adapter';
import { ANONYMOUS_SESSION } from './session.types';

const BASE_URL = 'http://localhost:3000';
const STORAGE_KEY = 'ol_access_token';

function createMockFetch(status: number, body: unknown): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

describe('JwtBearerSessionAdapter', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('getAccessToken', () => {
    it('should return null when no token is stored', async () => {
      const adapter = createJwtBearerSessionAdapter({ baseUrl: BASE_URL });

      expect(await adapter.getAccessToken()).toBeNull();
    });

    it('should return stored token from localStorage', async () => {
      localStorage.setItem(STORAGE_KEY, 'test-token');
      const adapter = createJwtBearerSessionAdapter({ baseUrl: BASE_URL });

      expect(await adapter.getAccessToken()).toBe('test-token');
    });
  });

  describe('getSession', () => {
    it('should return ANONYMOUS_SESSION when no token is stored', async () => {
      const fetchFn = createMockFetch(200, {});
      const adapter = createJwtBearerSessionAdapter({ baseUrl: BASE_URL, fetchFn });

      const session = await adapter.getSession();

      expect(session).toEqual(ANONYMOUS_SESSION);
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('should return authenticated session when valid token stored and /auth/me succeeds', async () => {
      localStorage.setItem(STORAGE_KEY, 'valid-token');
      const fetchFn = createMockFetch(200, {
        id: 'user_1',
        username: 'admin',
        email: 'admin@example.com',
      });
      const adapter = createJwtBearerSessionAdapter({ baseUrl: BASE_URL, fetchFn });

      const session = await adapter.getSession();

      expect(session).toEqual({
        status: 'authenticated',
        accessToken: 'valid-token',
        user: {
          id: 'user_1',
          username: 'admin',
          email: 'admin@example.com',
          roles: [],
        },
      });
      expect(fetchFn).toHaveBeenCalledWith('http://localhost:3000/auth/me', {
        headers: {
          Authorization: 'Bearer valid-token',
          Accept: 'application/json',
        },
      });
    });

    it('should return ANONYMOUS_SESSION and clear token when /auth/me returns 401', async () => {
      localStorage.setItem(STORAGE_KEY, 'expired-token');
      const fetchFn = createMockFetch(401, { message: 'Unauthorized' });
      const adapter = createJwtBearerSessionAdapter({ baseUrl: BASE_URL, fetchFn });

      const session = await adapter.getSession();

      expect(session).toEqual(ANONYMOUS_SESSION);
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });

    it('should return ANONYMOUS_SESSION and clear token on network failure', async () => {
      localStorage.setItem(STORAGE_KEY, 'some-token');
      const fetchFn = vi.fn().mockRejectedValue(new Error('Network error'));
      const adapter = createJwtBearerSessionAdapter({ baseUrl: BASE_URL, fetchFn });

      const session = await adapter.getSession();

      expect(session).toEqual(ANONYMOUS_SESSION);
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
  });

  describe('persistSession', () => {
    it('should store token in localStorage', async () => {
      const adapter = createJwtBearerSessionAdapter({ baseUrl: BASE_URL });

      await adapter.persistSession('new-token');

      expect(localStorage.getItem(STORAGE_KEY)).toBe('new-token');
    });
  });

  describe('clearSession', () => {
    it('should remove token from localStorage', async () => {
      localStorage.setItem(STORAGE_KEY, 'token-to-remove');
      const adapter = createJwtBearerSessionAdapter({ baseUrl: BASE_URL });

      await adapter.clearSession();

      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    });
  });
});
