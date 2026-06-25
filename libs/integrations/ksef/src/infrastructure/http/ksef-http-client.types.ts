/**
 * KSeF HTTP Client Types
 *
 * Type definitions for the KSeF HTTP client's request/response surface and
 * token-refresh contract. Mirrors the Allegro precedent
 * (`allegro-http-client.types.ts`): a tagged `RefreshOnUnauthorizedOutcome`
 * distinguishes transient network failure from genuine credential rejection so
 * the host's `AuthFailureClassifierPort` (ADR-008) can flip a connection to
 * `needs_reauth` only on a real rejection, never on a one-second blip.
 *
 * Kept in a dedicated `.types.ts` file per engineering-standards "Type
 * Definitions in Separate Files".
 *
 * @module libs/integrations/ksef/src/infrastructure/http
 */
import type { Logger } from '@openlinker/shared/logging';
import type { KsefEnvironment } from '../../domain/types/ksef-connection.types';

export type { KsefEnvironment };

/**
 * HTTP request options carried into a single KSeF call. `queryParams` are
 * stringified onto the URL; `headers` override the structural defaults except
 * `Authorization` and `X-Trace-Id`, which the client owns. `idempotent` lets a
 * caller opt a POST into the GET-style transient-retry policy (KSeF session
 * sub-resource reads are POSTs but safe to retry).
 */
export interface KsefHttpRequestOptions {
  headers?: Record<string, string>;
  queryParams?: Record<string, string | number | boolean>;
  /**
   * Opt a non-idempotent verb (POST) into transient-failure retries. Defaults
   * to false: a POST 5xx/network error fails fast unless the caller asserts the
   * operation is safe to repeat.
   */
  idempotent?: boolean;
  /**
   * Skip the lazy handshake + bearer injection for a genuinely-unauthenticated
   * call (the auth challenge/ksef-token bootstrap and the public-key-certificate
   * fetch), or for an auth call that supplies its own `Authorization` header
   * (the poll/redeem/refresh, which carry the short-lived authentication token).
   * Explicit per-call flag rather than path-prefix inference so a future
   * authenticated `/auth/*` sub-resource isn't silently bypassed.
   */
  skipAuth?: boolean;
  /**
   * Suppress the reactive-refresh path for a 401 on THIS call: instead of
   * invoking the refresh callback (which re-runs the handshake), a 401 throws
   * `KsefAuthenticationException` terminally. Set on the handshake's own
   * poll/redeem calls so a 401 there cannot re-enter the handshake — which would
   * nest a re-handshake inside the handshake (infinite recursion / wrong error).
   * Defaults to false (the normal reactive-refresh-on-401 behaviour).
   */
  noReactiveRefresh?: boolean;
}

/** Parsed JSON response: data plus status + lowercased response headers. */
export interface KsefHttpResponse<T = unknown> {
  data: T;
  status: number;
  headers: Record<string, string>;
}

/**
 * Binary response — raw bytes plus the provider-reported content type. Used for
 * document endpoints (e.g. a UPO PDF) that return a document rather than JSON.
 * `contentType` is the lowercased `content-type` header; the caller decides the
 * default when it's absent.
 */
export interface KsefBinaryResponse {
  data: Uint8Array;
  contentType: string;
  status: number;
  headers: Record<string, string>;
}

/**
 * KSeF access-token bundle returned by the auth handshake's final redeem step.
 *
 * Token taxonomy (kept as distinct fields for clarity):
 *  - `accessToken` — short-lived JWT; the ONLY field injected into the
 *    outbound `Authorization: Bearer` header.
 *  - `refreshToken` — longer-lived; held to rotate `accessToken` without
 *    re-running the full challenge/redeem handshake. Never sent as a bearer.
 *  - `accessTokenExpiresAt` — parsed from the access-token JWT `exp` at redeem
 *    time (never hardcoded); drives proactive refresh.
 *
 * SECURITY: none of these fields may be logged.
 */
export interface KsefAuthenticationToken {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
}

/**
 * Token Refresh Result
 *
 * Returned by a `TokenRefreshCallback` on success: the rotated access token
 * plus its parsed expiry so the client caches it and avoids an immediate
 * re-refresh.
 */
export interface TokenRefreshResult {
  accessToken: string;
  expiresAt: Date;
}

/**
 * Token Refresh Callback
 *
 * Invoked by `KsefHttpClient` on the proactive and reactive (401) refresh
 * paths. Implementations own cross-process serialization (e.g. a Redis lock).
 * Throwing surfaces as a `credential-rejected` (or `network-failure`, when the
 * thrown error is a `KsefNetworkException`) outcome — see
 * `RefreshOnUnauthorizedOutcome`.
 */
export type TokenRefreshCallback = (
  connectionId: string,
  traceId: string,
  logger: Logger,
) => Promise<TokenRefreshResult>;

/**
 * Reason a reactive (401) token refresh did not succeed (mirrors Allegro #499).
 *
 *  - `no-callback` — no `tokenRefreshCallback` registered. Defensive; treated
 *    as auth failure for safety.
 *  - `credential-rejected` — the auth endpoint responded 4xx/5xx or a local
 *    pre-flight rejected. Non-retryable: requires manual re-auth.
 *  - `network-failure` — the auth endpoint was unreachable (DNS/TLS/abort).
 *    Transient: callers retry with backoff.
 */
export const RefreshOutcomeReasonValues = [
  'no-callback',
  'credential-rejected',
  'network-failure',
] as const;
export type RefreshOutcomeReason = (typeof RefreshOutcomeReasonValues)[number];

/**
 * Tagged-result return type for the reactive 401 refresh path. Replaces a lossy
 * `boolean` so the client maps `network-failure` → retryable network exception
 * and `credential-rejected` → non-retryable auth exception.
 */
export type RefreshOnUnauthorizedOutcome =
  | { ok: true }
  | { ok: false; reason: RefreshOutcomeReason; cause?: Error };

/**
 * Per-call retry policy. Idempotent reads retry transient failures (5xx /
 * network / 429-with-backoff); non-idempotent writes fail fast unless opted in.
 */
export interface KsefRetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}
