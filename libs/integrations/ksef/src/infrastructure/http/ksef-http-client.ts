/**
 * KSeF HTTP Client
 *
 * Native-`fetch` (Node 18+) HTTP client for the KSeF Public API v2. Hand-rolls
 * retries, rate-limit backoff, token lifecycle, and structured logging, mirroring
 * the in-tree `AllegroHttpClient` precedent (no axios / @nestjs/axios).
 *
 * Token lifecycle:
 *  - The access token is produced lazily by the injected `authenticate` callback
 *    (the auth handshake) on the first authenticated request, then cached with a
 *    TTL read from the JWT `exp` (never hardcoded).
 *  - Proactive refresh: within `TOKEN_REFRESH_WINDOW_MS` of expiry, the
 *    `refresh` callback rotates the token before the request.
 *  - Reactive 401: the `refresh` callback is invoked once; a tagged
 *    `RefreshOnUnauthorizedOutcome` distinguishes credential rejection
 *    (→ `KsefAuthenticationException`, non-retryable) from network failure
 *    (→ `KsefNetworkException`, retryable). `403` is an authorization decision
 *    — never refreshed — and fails fast as a non-retryable `KsefApiException`.
 *  - Unauthenticated calls (the auth challenge/ksef-token bootstrap and the
 *    public-key-certificate fetch) pass `options.skipAuth` so the client skips
 *    the lazy handshake + bearer injection. Auth calls that carry their own
 *    short-lived token (poll/redeem/refresh) also set `skipAuth` and supply an
 *    explicit `Authorization` header. Explicit per-call flag rather than
 *    path-prefix inference.
 *
 * SECURITY: never logs the access/refresh token, the Authorization header, or
 * request/response bodies that may carry credential-derived material. Logs carry
 * the trace id, method, path, status, and duration only.
 *
 * @module libs/integrations/ksef/src/infrastructure/http
 * @implements {IKsefHttpClient}
 */
import { randomUUID } from 'crypto';
import { Logger } from '@openlinker/shared/logging';
import type { IKsefHttpClient } from './ksef-http-client.interface';
import type {
  KsefAuthenticationToken,
  KsefBinaryResponse,
  KsefHttpRequestOptions,
  KsefHttpResponse,
  KsefRetryConfig,
  RefreshOnUnauthorizedOutcome,
} from './ksef-http-client.types';
import { KsefApiException } from '../../domain/exceptions/ksef-api.exception';
import { KsefAuthenticationException } from '../../domain/exceptions/ksef-authentication.exception';
import { KsefNetworkException } from '../../domain/exceptions/ksef-network.exception';

/** Refresh proactively within this window of the access-token expiry. */
const TOKEN_REFRESH_WINDOW_MS = 60_000;

const DEFAULT_RETRY_CONFIG: KsefRetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1_000,
  maxDelayMs: 30_000,
  backoffMultiplier: 2,
};

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Lazily runs the handshake (first authenticated request) and rotates the token
 * (proactive + reactive). Both callbacks are wired by the factory.
 */
export interface KsefTokenLifecycle {
  /** Run the full auth handshake and return the initial token bundle. */
  authenticate(traceId: string, logger: Logger): Promise<KsefAuthenticationToken>;
  /** Rotate the access token (proactive/reactive). */
  refresh(traceId: string, logger: Logger): Promise<KsefAuthenticationToken>;
}

/** Internal control-flow signal: token was rotated, retry the request now. */
class TokenRefreshedSignal extends Error {
  constructor() {
    super('KSeF token refreshed; retry request');
    this.name = 'TokenRefreshedSignal';
  }
}

export class KsefHttpClient implements IKsefHttpClient {
  private readonly logger = new Logger(KsefHttpClient.name);
  private readonly baseUrl: string;
  private readonly retryConfig: KsefRetryConfig;

  private token: KsefAuthenticationToken | null = null;
  private refreshInFlight: Promise<void> | null = null;

  constructor(
    private readonly connectionId: string,
    baseUrl: string,
    private readonly lifecycle: KsefTokenLifecycle,
    retryConfig?: Partial<KsefRetryConfig>,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
  }

  async get<T = unknown>(path: string, options?: KsefHttpRequestOptions): Promise<KsefHttpResponse<T>> {
    return this.request<T>('GET', path, undefined, options, true);
  }

  async getExpectingBinary(
    path: string,
    options?: KsefHttpRequestOptions,
  ): Promise<KsefBinaryResponse> {
    const response = await this.request<Uint8Array>('GET', path, undefined, options, true, true);
    return {
      data: response.data,
      contentType: response.headers['content-type'] ?? '',
      status: response.status,
      headers: response.headers,
    };
  }

  async post<T = unknown>(
    path: string,
    body?: Record<string, unknown> | string,
    options?: KsefHttpRequestOptions,
  ): Promise<KsefHttpResponse<T>> {
    return this.request<T>('POST', path, body, options, options?.idempotent ?? false);
  }

  async postExpectingBinary(
    path: string,
    body?: Record<string, unknown> | string,
    options?: KsefHttpRequestOptions,
  ): Promise<KsefBinaryResponse> {
    const response = await this.request<Uint8Array>(
      'POST',
      path,
      body,
      options,
      options?.idempotent ?? false,
      true,
    );
    return {
      data: response.data,
      contentType: response.headers['content-type'] ?? '',
      status: response.status,
      headers: response.headers,
    };
  }

  /**
   * Retry loop. Idempotent calls retry transient failures (5xx/network);
   * non-idempotent calls fail fast except `429` (always backs off) and the
   * token-refresh retry.
   */
  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body: Record<string, unknown> | string | undefined,
    options: KsefHttpRequestOptions | undefined,
    idempotent: boolean,
    expectBinary = false,
  ): Promise<KsefHttpResponse<T>> {
    let lastError: Error | null = null;
    let delay = this.retryConfig.initialDelayMs;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        return await this.executeRequest<T>(method, path, body, options, expectBinary);
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (error instanceof TokenRefreshedSignal) {
          continue; // Retry immediately with the rotated token.
        }
        if (error instanceof KsefAuthenticationException) {
          throw error; // Credential rejection — never retry.
        }
        if (error instanceof KsefApiException) {
          const status = error.statusCode;
          if (status === 429) {
            if (attempt < this.retryConfig.maxRetries) {
              const retryAfter = this.parseRetryAfter(error) ?? delay;
              this.logger.warn(`[${this.connectionId}] Rate limited (429); retry in ${retryAfter}ms`);
              await this.sleep(retryAfter);
              delay = Math.min(delay * this.retryConfig.backoffMultiplier, this.retryConfig.maxDelayMs);
              continue;
            }
            throw error;
          }
          if (status !== undefined && status < 500) {
            // Deterministic non-5xx — never retry. Covers 4xx and a parse
            // failure on an otherwise-2xx body (a malformed response won't
            // become valid on re-fetch); 429 is already handled above.
            throw error;
          }
        }
        // 5xx / network: retry only when idempotent.
        if (idempotent && attempt < this.retryConfig.maxRetries) {
          this.logger.warn(
            `[${this.connectionId}] Request failed (attempt ${attempt + 1}); retry in ${delay}ms: ${lastError.message}`,
          );
          await this.sleep(delay);
          delay = Math.min(delay * this.retryConfig.backoffMultiplier, this.retryConfig.maxDelayMs);
          continue;
        }
        throw lastError;
      }
    }
    throw lastError ?? new Error('KSeF request failed after retries');
  }

  private async executeRequest<T>(
    method: 'GET' | 'POST',
    path: string,
    body: Record<string, unknown> | string | undefined,
    options: KsefHttpRequestOptions | undefined,
    expectBinary: boolean,
  ): Promise<KsefHttpResponse<T>> {
    const traceId = randomUUID();
    const startTime = Date.now();
    const requiresAuth = !options?.skipAuth;

    if (requiresAuth) {
      await this.ensureFreshToken(traceId);
    }

    const url = new URL(path.replace(/^\//, ''), `${this.baseUrl}/`);
    if (options?.queryParams) {
      for (const [key, value] of Object.entries(options.queryParams)) {
        url.searchParams.set(key, String(value));
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    if (options?.headers) {
      for (const [key, value] of Object.entries(options.headers)) {
        headers[key] = value;
      }
    }
    if (requiresAuth) {
      headers.Authorization = `Bearer ${this.getAccessTokenOrThrow()}`;
    }
    headers['X-Trace-Id'] = traceId;

    const requestBody = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      this.logger.debug(`[${traceId}] ${method} ${url.pathname} (connection ${this.connectionId})`);

      const response = await fetch(url.toString(), {
        method,
        headers,
        body: requestBody,
        signal: controller.signal,
      });

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key.toLowerCase()] = value;
      });

      const duration = Date.now() - startTime;
      this.logger.debug(`[${traceId}] ${response.status} (${duration}ms) ${method} ${url.pathname}`);

      if (!response.ok) {
        const errorBody = await response.text();
        await this.handleError(
          response.status,
          errorBody,
          url.toString(),
          responseHeaders,
          traceId,
          options?.noReactiveRefresh ?? false,
        );
      }

      if (expectBinary) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        return { data: bytes as unknown as T, status: response.status, headers: responseHeaders };
      }

      const text = await response.text();
      let data: T;
      try {
        data = text ? (JSON.parse(text) as T) : ({} as T);
      } catch {
        throw new KsefApiException(
          `Invalid JSON response from KSeF API: ${url.toString()}`,
          response.status,
          undefined,
          url.toString(),
        );
      }
      return { data, status: response.status, headers: responseHeaders };
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new KsefNetworkException(`KSeF request timed out after ${REQUEST_TIMEOUT_MS}ms`, url.toString());
      }
      if (
        error instanceof KsefApiException ||
        error instanceof KsefAuthenticationException ||
        error instanceof KsefNetworkException ||
        error instanceof TokenRefreshedSignal
      ) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new KsefNetworkException(`KSeF network error: ${message}`, url.toString(), {
        cause: error instanceof Error ? error : undefined,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Map an HTTP failure to the right domain exception. Only `401` (token
   * expired/rejected) attempts a single reactive refresh, then signals a retry
   * (success) / throws auth or network exception (per the tagged refresh
   * outcome). `403` is an authorization decision — refreshing the token can
   * never change it — so it fails fast as a non-retryable KsefApiException.
   */
  private async handleError(
    statusCode: number,
    body: string,
    url: string,
    headers: Record<string, string>,
    traceId: string,
    noReactiveRefresh: boolean,
  ): Promise<never> {
    if (statusCode === 401) {
      if (noReactiveRefresh) {
        // The handshake's own poll/redeem calls set this: a 401 here must NOT
        // re-enter the reactive-refresh path (which re-runs the handshake) — it
        // means the short-lived authentication token was itself rejected, a
        // terminal credential failure.
        this.logger.error(`[${traceId}] KSeF auth-handshake call rejected (${statusCode})`);
        throw new KsefAuthenticationException(
          `KSeF authentication failed (${statusCode}) for ${url}`,
          statusCode,
          url,
        );
      }
      const outcome = await this.refreshOnUnauthorized(traceId);
      if (outcome.ok) {
        throw new TokenRefreshedSignal();
      }
      if (outcome.reason === 'network-failure') {
        throw new KsefNetworkException(
          `KSeF token refresh failed (network): ${outcome.cause?.message ?? 'unknown'}`,
          url,
          { cause: outcome.cause },
        );
      }
      this.logger.error(`[${traceId}] KSeF authentication failed (${statusCode})`);
      throw new KsefAuthenticationException(
        `KSeF authentication failed (${statusCode}) for ${url}`,
        statusCode,
        url,
      );
    }

    if (statusCode === 429) {
      const retryAfterMs = this.parseRetryAfterHeader(headers['retry-after']);
      throw new KsefApiException(`KSeF rate limit exceeded: ${url}`, 429, body, url, retryAfterMs);
    }

    // 403 (authorization denied) + other 4xx + 5xx: KsefApiException carries
    // diagnostics-only body. 403 is non-retryable (the retry loop fails fast on
    // any sub-500 status that isn't 429).
    this.logger.error(`[${traceId}] KSeF API error (${statusCode}) ${url}`);
    throw new KsefApiException(`KSeF API error (${statusCode}): ${url}`, statusCode, body, url);
  }

  /**
   * Parse the `Retry-After` header — either delta-seconds (`"120"`) or an
   * HTTP-date (`"Wed, 21 Oct 2026 07:28:00 GMT"`) — into a millisecond delay.
   */
  private parseRetryAfterHeader(headerValue: string | undefined): number | undefined {
    if (!headerValue) {
      return undefined;
    }
    const seconds = Number(headerValue);
    if (Number.isFinite(seconds)) {
      return Math.max(0, seconds * 1000);
    }
    const dateMs = Date.parse(headerValue);
    if (Number.isFinite(dateMs)) {
      return Math.max(0, dateMs - Date.now());
    }
    return undefined;
  }

  private parseRetryAfter(error: KsefApiException): number | undefined {
    if (error.statusCode !== 429) {
      return undefined;
    }
    return error.retryAfterMs;
  }

  private getAccessTokenOrThrow(): string {
    if (!this.token) {
      throw new KsefAuthenticationException('KSeF access token unavailable after handshake');
    }
    return this.token.accessToken;
  }

  /**
   * Lazily run the handshake on first authenticated request, then refresh
   * proactively inside the refresh window. Single-flight per instance.
   */
  private async ensureFreshToken(traceId: string): Promise<void> {
    if (!this.token) {
      this.token = await this.lifecycle.authenticate(traceId, this.logger);
      return;
    }
    if (Date.now() < this.token.accessTokenExpiresAt.getTime() - TOKEN_REFRESH_WINDOW_MS) {
      return;
    }
    if (this.refreshInFlight) {
      await this.refreshInFlight;
      return;
    }
    this.refreshInFlight = this.lifecycle
      .refresh(traceId, this.logger)
      .then((rotated) => {
        this.token = rotated;
      })
      .catch((err: unknown) => {
        // Proactive refresh failure: fall back to the reactive 401 path on the
        // actual request rather than failing pre-flight.
        this.logger.warn(
          `[${traceId}] Proactive token refresh failed; relying on reactive 401: ${(err as Error).message}`,
        );
      })
      .finally(() => {
        this.refreshInFlight = null;
      });
    await this.refreshInFlight;
  }

  private async refreshOnUnauthorized(traceId: string): Promise<RefreshOnUnauthorizedOutcome> {
    try {
      this.token = await this.lifecycle.refresh(traceId, this.logger);
      return { ok: true };
    } catch (error) {
      const cause = error as Error;
      if (cause instanceof KsefNetworkException) {
        return { ok: false, reason: 'network-failure', cause };
      }
      return { ok: false, reason: 'credential-rejected', cause };
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
