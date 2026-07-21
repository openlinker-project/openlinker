/**
 * JWT Bearer Session Adapter
 *
 * Memory-only access-token holder paired with silent refresh against
 * `POST /auth/refresh` (#710). The previous implementation persisted
 * the access token to `localStorage` — that's gone. The token now
 * lives in a closure variable scoped to one adapter instance.
 *
 * On boot, `getSession()` calls `refresh()` to attempt silent refresh
 * via the HttpOnly cookie. On every API 401, the `ApiClient` calls
 * `refresh()` once and retries. Concurrent refresh requests are
 * coalesced so a burst of 401s after an idle tab regains focus only
 * triggers one network round-trip.
 *
 * CSRF: the SPA reads the non-HttpOnly `ol_csrf` cookie and mirrors
 * it into the `X-CSRF-Token` header on every cookie-authenticated
 * request (refresh, logout). See `auth.cookies.ts` server-side for
 * the contract.
 */
import { withApiVersion } from '../config/api-version';
import type { SessionAdapter } from './session-adapter';
import {
  ANONYMOUS_SESSION,
  type MeResponse,
  type Session,
  type SessionUser,
} from './session.types';

const CSRF_HEADER_NAME = 'X-CSRF-Token';

interface JwtBearerSessionAdapterConfig {
  baseUrl: string;
  fetchFn?: typeof fetch;
}

function buildUrl(baseUrl: string, path: string): string {
  // The auth endpoints (`/auth/refresh`, `/auth/me`, `/auth/logout`) are served
  // under `/v1` (#1133) — pin the same major via the shared prefix helper.
  return `${baseUrl.replace(/\/$/, '')}${withApiVersion(path)}`;
}

function readCsrfCookie(): string | null {
  const match = document.cookie.match(/(?:^|;\s*)ol_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

interface RefreshResponse {
  access_token: string;
}

export function createJwtBearerSessionAdapter({
  baseUrl,
  fetchFn = fetch,
}: JwtBearerSessionAdapterConfig): SessionAdapter {
  let accessToken: string | null = null;
  let inFlightRefresh: Promise<string | null> | null = null;

  async function performRefresh(): Promise<string | null> {
    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
      };
      const csrf = readCsrfCookie();
      if (csrf) {
        headers[CSRF_HEADER_NAME] = csrf;
      }
      const response = await fetchFn(buildUrl(baseUrl, '/auth/refresh'), {
        method: 'POST',
        credentials: 'include',
        headers,
      });
      if (!response.ok) {
        accessToken = null;
        return null;
      }
      const data = (await response.json()) as RefreshResponse;
      accessToken = data.access_token;
      return accessToken;
    } catch {
      accessToken = null;
      return null;
    }
  }

  function refresh(): Promise<string | null> {
    if (inFlightRefresh) return inFlightRefresh;
    inFlightRefresh = performRefresh().finally(() => {
      inFlightRefresh = null;
    });
    return inFlightRefresh;
  }

  async function getAccessToken(): Promise<string | null> {
    if (accessToken) return accessToken;
    return refresh();
  }

  return {
    refresh,

    async getAccessToken(): Promise<string | null> {
      return getAccessToken();
    },

    async getSession(): Promise<Session> {
      const token = await getAccessToken();
      if (!token) {
        return ANONYMOUS_SESSION;
      }

      try {
        const response = await fetchFn(buildUrl(baseUrl, '/auth/me'), {
          credentials: 'include',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          accessToken = null;
          return ANONYMOUS_SESSION;
        }

        const data = (await response.json()) as MeResponse;
        const user: SessionUser = {
          id: data.id,
          username: data.username,
          email: data.email,
          role: data.role ?? '',
          permissions: data.permissions ?? [],
          // Default-on (#1743): a payload from an API predating this field
          // reads as consent granted, matching the backend default.
          analyticsConsent: data.analyticsConsent ?? true,
        };
        return {
          status: 'authenticated',
          accessToken: token,
          user,
        };
      } catch {
        accessToken = null;
        return ANONYMOUS_SESSION;
      }
    },

    async persistSession(token: string): Promise<void> {
      accessToken = token;
    },

    async clearSession(): Promise<void> {
      accessToken = null;
      try {
        const headers: Record<string, string> = {};
        const csrf = readCsrfCookie();
        if (csrf) {
          headers[CSRF_HEADER_NAME] = csrf;
        }
        await fetchFn(buildUrl(baseUrl, '/auth/logout'), {
          method: 'POST',
          credentials: 'include',
          headers,
        });
      } catch {
        // best-effort — the cookie is cleared server-side when reachable;
        // when not, the in-memory token has already been wiped and the
        // refresh cookie will expire naturally.
      }
    },
  };
}
