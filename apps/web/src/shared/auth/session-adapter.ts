/**
 * Session Adapter
 *
 * Storage- and transport-agnostic surface that the `SessionProvider`
 * uses to read the current session and the `ApiClient` uses to attach
 * an access token to outbound requests.
 *
 * Implementations choose where the access token lives:
 *   - `NoopSessionAdapter` returns null (anonymous mode).
 *   - `JwtBearerSessionAdapter` holds the access token in memory and
 *     refreshes it silently against `/auth/refresh` (#710).
 *
 * The optional `refresh()` hook lets the `ApiClient` ask the adapter
 * to swap a stale access token for a fresh one when an API call
 * returns 401. Implementations backed by a refresh-token flow
 * (HttpOnly cookie + silent refresh) implement it; adapters without
 * server-side refresh (e.g. NoopSessionAdapter) omit it and the
 * 401-retry no-ops.
 */
import type { Session } from './session.types';

export interface SessionAdapter {
  getSession(): Promise<Session>;
  getAccessToken(): Promise<string | null>;
  persistSession(token: string): Promise<void>;
  clearSession(): Promise<void>;
  /**
   * Optional. Force a refresh of the access token (e.g. on 401).
   * Returns the new access token or null if refresh failed. Adapters
   * without a refresh path omit it — the host treats absence as
   * "refresh not supported".
   */
  refresh?(): Promise<string | null>;
}
