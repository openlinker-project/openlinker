/**
 * Allegro HTTP Client
 *
 * HTTP client implementation for Allegro Public API. Uses native fetch
 * (Node 18+) for framework-agnostic HTTP requests. Handles authentication,
 * request building, response parsing, retries with backoff, rate limiting,
 * and error handling.
 *
 * @module libs/integrations/allegro/src/infrastructure/http
 * @implements {IAllegroHttpClient}
 */
import { IAllegroHttpClient, AllegroHttpRequestOptions, AllegroHttpResponse } from './allegro-http-client.interface';
import { TokenRefreshCallback, TokenRefreshResult } from './allegro-http-client.types';
import { AllegroConnectionConfig } from '../../domain/types/allegro-config.types';
import { AllegroCredentials } from '../../domain/types/allegro-credentials.types';
import { AllegroApiException } from '../../domain/exceptions/allegro-api.exception';
import { AllegroAuthenticationException } from '../../domain/exceptions/allegro-authentication.exception';
import { AllegroRateLimitException } from '../../domain/exceptions/allegro-rate-limit.exception';
import { Logger } from '@openlinker/shared/logging';
import { randomUUID } from 'crypto';

/**
 * Retry configuration
 */
interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

/**
 * Default retry configuration
 */
const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

/**
 * Proactive token-refresh window.
 *
 * Refresh proactively when the current access token is within this many
 * milliseconds of its expiresAt timestamp, so we don't pay a wasted 401
 * round-trip on the next request after an idle period.
 */
const TOKEN_REFRESH_WINDOW_MS = 60_000;

/**
 * Token refreshed error
 *
 * Internal error used to signal that token was refreshed and request should be retried.
 * This is not a real error - it's a control flow mechanism.
 */
class TokenRefreshedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TokenRefreshedError';
  }
}

/**
 * Allegro HTTP Client
 *
 * Implements HTTP client for Allegro Public API using native fetch.
 */
export class AllegroHttpClient implements IAllegroHttpClient {
  /**
   * Cooldown after a failed proactive refresh. During this window pre-request
   * checks short-circuit and rely on the reactive 401 path, preventing a
   * refresh storm when the refresh endpoint is unhealthy.
   */
  private static readonly PROACTIVE_REFRESH_FAILURE_COOLDOWN_MS = 5_000;

  private readonly logger = new Logger(AllegroHttpClient.name);
  private readonly baseUrl: string;
  private accessToken: string; // Mutable to support token refresh
  private tokenExpiresAt: number | undefined; // Epoch ms; undefined disables proactive refresh
  private refreshInFlight: Promise<void> | null = null; // Per-instance single-flight
  private proactiveRefreshCooldownUntil: number | undefined; // Epoch ms; set on failure
  private readonly retryConfig: RetryConfig;
  private readonly connectionId: string;
  private readonly tokenRefreshCallback?: TokenRefreshCallback;

  constructor(
    connectionId: string,
    baseUrl: string,
    credentials: AllegroCredentials,
    _config: AllegroConnectionConfig,
    retryConfig?: Partial<RetryConfig>,
    tokenRefreshCallback?: TokenRefreshCallback,
  ) {
    this.connectionId = connectionId;
    // Normalize baseUrl (remove trailing slash)
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.accessToken = credentials.accessToken;
    this.tokenExpiresAt = this.normalizeExpiresAt(credentials.expiresAt);
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
    this.tokenRefreshCallback = tokenRefreshCallback;
  }

  async get<T = unknown>(
    path: string,
    options?: Omit<AllegroHttpRequestOptions, 'method' | 'body'>,
  ): Promise<AllegroHttpResponse<T>> {
    return this.request<T>('GET', path, undefined, options);
  }

  async post<T = unknown>(
    path: string,
    body?: Record<string, unknown> | string,
    options?: Omit<AllegroHttpRequestOptions, 'method' | 'body'>,
  ): Promise<AllegroHttpResponse<T>> {
    return this.request<T>('POST', path, body, options);
  }

  async put<T = unknown>(
    path: string,
    body?: Record<string, unknown> | string,
    options?: Omit<AllegroHttpRequestOptions, 'method' | 'body'>,
  ): Promise<AllegroHttpResponse<T>> {
    return this.request<T>('PUT', path, body, options);
  }

  async patch<T = unknown>(
    path: string,
    body?: Record<string, unknown> | string,
    options?: Omit<AllegroHttpRequestOptions, 'method' | 'body'>,
  ): Promise<AllegroHttpResponse<T>> {
    return this.request<T>('PATCH', path, body, options);
  }

  /**
   * Make HTTP request with retry logic
   *
   * @param method - HTTP method
   * @param path - API path
   * @param body - Request body (optional)
   * @param options - Request options
   * @returns Response data
   */
  private async request<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: Record<string, unknown> | string,
    options?: Omit<AllegroHttpRequestOptions, 'method' | 'body'>,
  ): Promise<AllegroHttpResponse<T>> {
    let lastError: Error | null = null;
    let delay = this.retryConfig.initialDelayMs;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        return await this.executeRequest<T>(method, path, body, options);
      } catch (error: unknown) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Handle token refresh - retry immediately with new token
        if (error instanceof TokenRefreshedError) {
          this.logger.debug(`Token refreshed, retrying request (attempt ${attempt + 1})`);
          continue; // Retry immediately with new token
        }

        // Don't retry on authentication errors (401) unless token was refreshed
        if (error instanceof AllegroAuthenticationException) {
          throw error;
        }

        // Handle rate limit (429) - respect Retry-After header
        if (error instanceof AllegroRateLimitException) {
          if (attempt < this.retryConfig.maxRetries) {
            const retryAfter = error.retryAfter || delay;
            this.logger.warn(
              `Rate limit exceeded (attempt ${attempt + 1}/${this.retryConfig.maxRetries + 1}), retrying after ${retryAfter}ms`,
            );
            await this.sleep(retryAfter);
            delay = Math.min(delay * this.retryConfig.backoffMultiplier, this.retryConfig.maxDelayMs);
            continue;
          }
          throw error;
        }

        // Don't retry on client errors (4xx) except 429
        if (error instanceof AllegroApiException) {
          const statusCode = error.statusCode;
          if (statusCode !== undefined && statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
            throw error; // Don't retry client errors (except 429)
          }
        }

        // Retry on server errors (5xx) or network errors
        if (attempt < this.retryConfig.maxRetries) {
          this.logger.warn(
            `Request failed (attempt ${attempt + 1}/${this.retryConfig.maxRetries + 1}), retrying in ${delay}ms: ${lastError.message}`,
          );
          await this.sleep(delay);
          delay = Math.min(delay * this.retryConfig.backoffMultiplier, this.retryConfig.maxDelayMs);
        }
      }
    }

    // All retries exhausted
    throw lastError || new Error('Request failed after retries');
  }

  /**
   * Execute HTTP request
   *
   * @param method - HTTP method
   * @param path - API path
   * @param body - Request body (optional)
   * @param options - Request options
   * @returns Response data
   */
  private async executeRequest<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: Record<string, unknown> | string,
    options?: Omit<AllegroHttpRequestOptions, 'method' | 'body'>,
  ): Promise<AllegroHttpResponse<T>> {
    const startTime = Date.now();
    const traceId = randomUUID();

    // Proactively refresh the token before building Authorization if we're
    // inside the refresh window. No-op when no callback or no expiresAt,
    // preserving behavior for connections without expiry metadata.
    await this.ensureFreshToken(traceId);

    // Build URL with query parameters
    const url = new URL(path, this.baseUrl);
    if (options?.queryParams) {
      Object.entries(options.queryParams).forEach(([key, value]) => {
        url.searchParams.set(key, String(value));
      });
    }

    // Build headers.
    // Order: defaults → caller overrides → structural (immutable).
    // Structural headers land last because Authorization is owned by the token-refresh
    // flow and X-Trace-Id must match the log correlation ID — neither is a caller concern.
    const headers = new Headers();
    headers.set('Content-Type', 'application/vnd.allegro.public.v1+json');
    headers.set('Accept', 'application/vnd.allegro.public.v1+json');

    if (options?.headers) {
      for (const [key, value] of Object.entries(options.headers)) {
        headers.set(key, value);
      }
    }

    headers.set('Authorization', `Bearer ${this.accessToken}`);
    headers.set('X-Trace-Id', traceId);

    // Convert Headers to plain object for fetch (Node.js fetch may have issues with Headers object)
    const headersObject: Record<string, string> = {};
    headers.forEach((value, key) => {
      headersObject[key] = value;
    });

    // Prepare request body
    let requestBody: string | undefined;
    if (body) {
      requestBody = typeof body === 'string' ? body : JSON.stringify(body);
    }

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutMs = 30000; // 30 seconds default
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      this.logger.debug(
        `[${traceId}] ${method} ${url.pathname}${url.search} (connection: ${this.connectionId})`,
      );

      const response = await fetch(url.toString(), {
        method,
        headers: headersObject,
        body: requestBody,
        signal: controller.signal,
      });

      if (!response || !response.headers) {
        throw new Error('Invalid response from fetch: missing response or headers');
      }

      const duration = Date.now() - startTime;
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key.toLowerCase()] = value;
      });

      this.logger.debug(
        `[${traceId}] Response: ${response.status} (${duration}ms) - ${method} ${url.pathname}`,
      );

      const responseBody = await response.text();

      // Handle errors
      if (!response.ok) {
        await this.handleError(response.status, responseBody, url.toString(), responseHeaders, traceId);
      }

      // Parse JSON response
      let data: T;
      try {
        data = responseBody ? (JSON.parse(responseBody) as T) : ({} as T);
      } catch (parseError) {
        this.logger.error(`[${traceId}] Failed to parse JSON response: ${(parseError as Error).message}`);
        throw new AllegroApiException(
          `Invalid JSON response from Allegro API: ${url.toString()}`,
          response.status,
          responseBody.substring(0, 500),
          url.toString(),
        );
      }

      return {
        data,
        status: response.status,
        headers: responseHeaders,
      };
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AllegroApiException(
          `Request timeout after ${timeoutMs}ms: ${url.toString()}`,
          undefined,
          undefined,
          url.toString(),
        );
      }
      if (
        error instanceof AllegroApiException ||
        error instanceof AllegroAuthenticationException ||
        error instanceof AllegroRateLimitException ||
        // TokenRefreshedError is an internal control-flow signal for request()
        // to retry immediately with the new access token. Without this re-throw
        // it would get wrapped in AllegroApiException("Network error: ...") and
        // the `continue` branch in request() would never match.
        error instanceof TokenRefreshedError
      ) {
        throw error;
      }
      const errorMessage: string = error instanceof Error ? error.message : String(error);
      throw new AllegroApiException(
        `Network error: ${errorMessage}`,
        undefined,
        undefined,
        url.toString(),
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Handle HTTP error responses
   *
   * For 401 errors, attempts token refresh if a refresh callback is available.
   * Otherwise, throws AllegroAuthenticationException.
   */
  private async handleError(
    statusCode: number,
    body: string,
    url: string,
    headers: Record<string, string>,
    traceId: string,
  ): Promise<never> {
    if (statusCode === 401) {
      // Check if this is a token expiry (vs invalid token)
      const bodyLower = body.toLowerCase();
      const isTokenExpired =
        bodyLower.includes('expired') ||
        bodyLower.includes('token') ||
        bodyLower.includes('invalid_token') ||
        bodyLower.includes('access_token');
      
      if (isTokenExpired && this.tokenRefreshCallback) {
        // Attempt token refresh
        try {
          this.logger.warn(
            `[${traceId}] Access token expired, attempting refresh (connection: ${this.connectionId})`,
          );
          const refreshResult = await this.tokenRefreshCallback(this.connectionId);
          this.applyRefreshResult(refreshResult);
          this.logger.log(
            `[${traceId}] Access token refreshed successfully (connection: ${this.connectionId})`,
          );
          // Return a special error that indicates refresh succeeded (caller should retry)
          throw new TokenRefreshedError('Token refreshed, retry request');
        } catch (error) {
          if (error instanceof TokenRefreshedError) {
            // Re-throw to signal caller to retry
            throw error;
          }
          // Refresh failed - log and fall through to throw authentication exception
          this.logger.error(
            `[${traceId}] Token refresh failed: ${(error as Error).message} (connection: ${this.connectionId})`,
          );
        }
      } else if (isTokenExpired) {
        this.logger.warn(
          `[${traceId}] Access token expired or invalid, refresh required but no refresh callback available (connection: ${this.connectionId})`,
        );
      }
      
      this.logger.error(`[${traceId}] Authentication failed: Invalid or expired access token`);
      throw new AllegroAuthenticationException(
        `Authentication failed: Invalid or expired access token for ${url}`,
        statusCode,
        url,
      );
    }

    if (statusCode === 429) {
      // Extract Retry-After header (seconds)
      const retryAfterHeader = headers['retry-after'];
      const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) * 1000 : undefined; // Convert to milliseconds

      this.logger.warn(
        `[${traceId}] Rate limit exceeded (429)${retryAfter ? `, retry after ${retryAfter}ms` : ''}`,
      );
      throw new AllegroRateLimitException(
        `Rate limit exceeded: ${url}`,
        retryAfter,
        url,
      );
    }

    if (statusCode >= 500) {
      this.logger.error(`[${traceId}] Allegro API server error (${statusCode}): ${url}`);
      throw new AllegroApiException(
        `Allegro API server error (${statusCode}): ${url}`,
        statusCode,
        body.substring(0, 500),
        url,
      );
    }

    // Other client errors (4xx)
    this.logger.error(`[${traceId}] Allegro API error (${statusCode}): ${url} - ${body.substring(0, 200)}`);
    throw new AllegroApiException(
      `Allegro API error (${statusCode}): ${url}`,
      statusCode,
      body.substring(0, 500),
      url,
    );
  }

  /**
   * Ensure the access token is fresh before sending a request.
   *
   * No-op when the client has no refresh callback or no expiresAt (backward
   * compat for connections that were created before expiry was persisted).
   * Short-circuits during the post-failure cooldown so a sick refresh endpoint
   * can't trigger a refresh storm — the reactive 401 path stays as the
   * fallback.
   *
   * Uses per-instance single-flight: concurrent callers await the same
   * in-flight refresh promise instead of each triggering their own. Cross-
   * process / cross-instance serialization is handled by
   * `AllegroTokenRefreshService`'s Redis lock.
   */
  private async ensureFreshToken(traceId: string): Promise<void> {
    if (!this.tokenRefreshCallback || this.tokenExpiresAt === undefined) {
      return;
    }
    if (
      this.proactiveRefreshCooldownUntil !== undefined &&
      Date.now() < this.proactiveRefreshCooldownUntil
    ) {
      return;
    }
    if (Date.now() < this.tokenExpiresAt - TOKEN_REFRESH_WINDOW_MS) {
      return;
    }
    if (this.refreshInFlight) {
      await this.refreshInFlight;
      return;
    }
    this.refreshInFlight = this.performProactiveRefresh(traceId).finally(() => {
      this.refreshInFlight = null;
    });
    await this.refreshInFlight;
  }

  /**
   * Perform the actual proactive refresh. Updates cached access token and
   * expiry on success; records a cooldown on failure so subsequent requests
   * skip the proactive path and rely on the reactive 401 path.
   */
  private async performProactiveRefresh(traceId: string): Promise<void> {
    if (!this.tokenRefreshCallback) {
      return;
    }
    try {
      this.logger.debug(
        `[${traceId}] Proactive token refresh (connection: ${this.connectionId})`,
      );
      const refreshResult = await this.tokenRefreshCallback(this.connectionId);
      this.applyRefreshResult(refreshResult);
      this.logger.log(
        `[${traceId}] Proactive token refresh succeeded (connection: ${this.connectionId})`,
      );
    } catch (error) {
      // Deliberately swallowed: the reactive 401 path is the documented
      // fallback (see issue #336 AC). Record a short cooldown so we don't
      // re-attempt on every request while the endpoint is unhealthy.
      this.proactiveRefreshCooldownUntil =
        Date.now() + AllegroHttpClient.PROACTIVE_REFRESH_FAILURE_COOLDOWN_MS;
      this.logger.warn(
        `[${traceId}] Proactive token refresh failed, falling back to reactive 401 path: ${(error as Error).message} (connection: ${this.connectionId})`,
      );
    }
  }

  /**
   * Apply a successful refresh result to cached client state.
   *
   * Single place where the access token and cached expiry get updated, so
   * the proactive and reactive refresh paths can't drift (e.g., one forgetting
   * to clear the cooldown or update the expiry).
   */
  private applyRefreshResult(result: TokenRefreshResult): void {
    this.accessToken = result.accessToken;
    this.tokenExpiresAt = this.normalizeExpiresAt(result.expiresAt);
    this.proactiveRefreshCooldownUntil = undefined;
  }

  /**
   * Normalize an `expiresAt` value (Date | string | undefined) to epoch ms.
   *
   * Returns `undefined` for absent values, invalid Date objects, or strings
   * that don't parse — which disables proactive refresh for that client
   * instance rather than letting NaN silently poison the comparison.
   */
  private normalizeExpiresAt(value: Date | string | undefined): number | undefined {
    if (value === undefined) {
      return undefined;
    }
    const ms = value instanceof Date ? value.getTime() : Date.parse(value);
    return Number.isFinite(ms) ? ms : undefined;
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

