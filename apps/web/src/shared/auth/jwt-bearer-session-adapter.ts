import type { SessionAdapter } from './session-adapter';
import { ANONYMOUS_SESSION, type MeResponse, type Session, type SessionUser } from './session.types';

const STORAGE_KEY = 'ol_access_token';

interface JwtBearerSessionAdapterConfig {
  baseUrl: string;
  fetchFn?: typeof fetch;
}

function buildMeUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, '')}/auth/me`;
}

export function createJwtBearerSessionAdapter({
  baseUrl,
  fetchFn = fetch,
}: JwtBearerSessionAdapterConfig): SessionAdapter {
  return {
    async getAccessToken(): Promise<string | null> {
      return localStorage.getItem(STORAGE_KEY);
    },

    async getSession(): Promise<Session> {
      const token = localStorage.getItem(STORAGE_KEY);

      if (!token) {
        return ANONYMOUS_SESSION;
      }

      try {
        const response = await fetchFn(buildMeUrl(baseUrl), {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          localStorage.removeItem(STORAGE_KEY);
          return ANONYMOUS_SESSION;
        }

        const data = (await response.json()) as MeResponse;

        const user: SessionUser = {
          id: data.id,
          username: data.username,
          email: data.email,
          role: data.role ?? '',
          permissions: data.permissions ?? [],
        };

        return {
          status: 'authenticated',
          accessToken: token,
          user,
        };
      } catch {
        localStorage.removeItem(STORAGE_KEY);
        return ANONYMOUS_SESSION;
      }
    },

    async persistSession(token: string): Promise<void> {
      localStorage.setItem(STORAGE_KEY, token);
    },

    async clearSession(): Promise<void> {
      localStorage.removeItem(STORAGE_KEY);
    },
  };
}
