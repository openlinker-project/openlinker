/**
 * eparagony.pl HTTP Client
 *
 * Native-`fetch` transport for the Documents REST API v3 - the shared client
 * every eparagony.pl adapter routes through. Mirrors the in-tree precedent
 * (`ErliHttpClient` / `AllegroHttpClient`; no axios). Owns four concerns:
 *
 *   1. **OAuth2 client-credentials token lifecycle.** The token is fetched from
 *      the SEPARATE `login[.sandbox].eparagony.pl` host, cached for its own
 *      `expires_in` minus a refresh margin, and refreshed under a single
 *      in-flight promise so a burst of concurrent calls issues ONE token
 *      request - the vendor rate-limits `/auth/token` per IP and explicitly
 *      tells integrators not to fetch a token per request.
 *   2. **Reactive re-auth.** A `401` on an API call invalidates the cached token
 *      and retries once, covering a token revoked before its stated expiry.
 *   3. **Bounded retries with jittered backoff**, honouring `Retry-After` and
 *      clamping it so a hostile value cannot stall a worker.
 *   4. **Mapping non-2xx onto typed errors** carrying the neutral `failureMode`
 *      core reads structurally.
 *
 * Construction is PER CONNECTION inside `EparagonyAdapterFactory` - never
 * `@Injectable`, never a DI singleton, because it closes over one connection's
 * client secret and its token cache.
 *
 * @module libs/integrations/eparagony/src/infrastructure/http
 * @see {@link IEparagonyHttpClient} for the transport contract adapters use
 */
import type { LoggerPort } from '@openlinker/shared/logging';
import type { FetchLike } from '@openlinker/shared/http';

import {
  EPARAGONY_API_VERSION,
  EPARAGONY_SCOPE_PARAM,
  EPARAGONY_USER_AGENT,
} from '../../eparagony.constants';
import { EparagonyApiError } from '../../domain/exceptions/eparagony-api.error';
import { EparagonyConfigException } from '../../domain/exceptions/eparagony-config.exception';
import { EparagonyNetworkError } from '../../domain/exceptions/eparagony-network.error';
import type {
  EparagonyErrorBody,
  EparagonyTokenResponse,
} from '../../domain/types/eparagony-api.types';
import type { IEparagonyHttpClient } from './eparagony-http-client.interface';
import {
  DEFAULT_RETRY_CONFIG,
  type EparagonyHttpMethod,
  type EparagonyHttpResponse,
  type EparagonyRequestOptions,
  type RetryConfig,
} from './eparagony-http-client.types';

/** Per-ATTEMPT timeout, not a whole-call deadline. The adapter owns the outer deadline. */
const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Refresh this long before the vendor-stated expiry. Covers clock skew and the
 * flight time of a request that starts just under the wire.
 */
const TOKEN_REFRESH_MARGIN_MS = 60_000;

/** Fallback lifetime when the token response omits or mangles `expires_in`. */
const TOKEN_FALLBACK_LIFETIME_MS = 5 * 60_000;

/** Hard ceiling on a buffered response body. The timeout bounds time, not bytes. */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export interface EparagonyHttpClientConfig {
  connectionId: string;
  apiBaseUrl: string;
  authBaseUrl: string;
  clientId: string;
  clientSecret: string;
  /** `X-Integration-Id` header value; omitted from requests when absent. */
  integrationId?: string;
}

/** Internal marker for a retryable transport failure. Never escapes the client. */
class RetryableHttpError extends Error {
  constructor(
    message: string,
    readonly kind: 'rate-limit' | 'transport',
    readonly retryAfterMs?: number,
    readonly retryCause?: unknown,
  ) {
    super(message);
    this.name = 'RetryableHttpError';
  }
}

interface CachedToken {
  accessToken: string;
  /** Epoch ms after which the token is treated as expired (margin already applied). */
  refreshAfter: number;
}

export class EparagonyHttpClient implements IEparagonyHttpClient {
  private readonly retryConfig: RetryConfig;
  private readonly apiBaseUrl: string;
  private readonly apiOrigin: string;
  private readonly authBaseUrl: string;
  private token: CachedToken | null = null;
  /** Single in-flight token request, so concurrent callers share one round-trip. */
  private tokenInFlight: Promise<string> | null = null;

  /**
   * `fetchImpl` is **required**, deliberately (mirrors `ErliHttpClient` /
   * `AllegroHttpClient`). An optional `?? globalThis.fetch` default would let a
   * forgotten wiring silently issue unrated traffic that neither the
   * `no-restricted-globals` rule nor `check-outbound-http.mjs` would flag.
   */
  constructor(
    private readonly config: EparagonyHttpClientConfig,
    private readonly logger: LoggerPort,
    private readonly fetchImpl: FetchLike,
    retryConfig?: Partial<RetryConfig>,
  ) {
    this.apiBaseUrl = ensureTrailingSlash(config.apiBaseUrl);
    this.apiOrigin = originOf(config.apiBaseUrl, config.connectionId);
    this.authBaseUrl = ensureTrailingSlash(config.authBaseUrl);
    // Assert the auth host is usable at construction, not at first token fetch.
    originOf(config.authBaseUrl, config.connectionId);
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
  }

  get<T>(path: string, options?: EparagonyRequestOptions): Promise<EparagonyHttpResponse<T>> {
    return this.request<T>('GET', path, undefined, options);
  }

  post<T>(
    path: string,
    body: unknown,
    options?: EparagonyRequestOptions,
  ): Promise<EparagonyHttpResponse<T>> {
    return this.request<T>('POST', path, body, options);
  }

  invalidateToken(): void {
    this.token = null;
  }

  async ensureToken(): Promise<void> {
    await this.acquireToken();
  }

  // -------------------------------------------------------------------------
  // Request pipeline
  // -------------------------------------------------------------------------

  private async request<T>(
    method: EparagonyHttpMethod,
    path: string,
    body: unknown,
    options?: EparagonyRequestOptions,
  ): Promise<EparagonyHttpResponse<T>> {
    const idempotent = method === 'GET' || options?.idempotent === true;
    // Resolve (and host-escape-guard) the URL once; it is fixed across attempts.
    const url = this.buildApiUrl(path);
    let delay = this.retryConfig.initialDelayMs;
    let reauthorized = false;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        const token = await this.acquireToken();
        return await this.executeOnce<T>(method, path, url, token, body, idempotent, options);
      } catch (error) {
        // A 401 mid-session means the token died before its stated expiry.
        // Drop it and retry once - but only once, so genuinely bad credentials
        // fail fast instead of burning the whole retry budget.
        if (
          !reauthorized &&
          error instanceof EparagonyApiError &&
          error.statusCode === 401 &&
          attempt < this.retryConfig.maxRetries
        ) {
          reauthorized = true;
          this.invalidateToken();
          this.logger.warn(
            `eparagony.pl ${method} ${path} returned 401; refreshing the access token and retrying once ` +
              `[connectionId=${this.config.connectionId}]`,
          );
          continue;
        }
        if (!(error instanceof RetryableHttpError)) {
          throw error;
        }
        if (attempt === this.retryConfig.maxRetries) {
          throw this.toExhaustedError(error);
        }
        const waitMs =
          error.retryAfterMs !== undefined
            ? this.clampDelayMs(error.retryAfterMs)
            : this.jitter(delay);
        this.logger.warn(
          `eparagony.pl ${method} ${path} failed (attempt ${attempt + 1}/${this.retryConfig.maxRetries + 1}); ` +
            `retrying in ${waitMs}ms [connectionId=${this.config.connectionId}]`,
        );
        await sleep(waitMs);
        delay = Math.min(delay * this.retryConfig.backoffMultiplier, this.retryConfig.maxDelayMs);
      }
    }

    // Unreachable: the final attempt either returns or throws above.
    throw new EparagonyNetworkError('eparagony.pl request exhausted its retry budget');
  }

  private async executeOnce<T>(
    method: EparagonyHttpMethod,
    path: string,
    url: string,
    token: string,
    body: unknown,
    idempotent: boolean,
    options?: EparagonyRequestOptions,
  ): Promise<EparagonyHttpResponse<T>> {
    const timeoutMs = options?.timeoutMs ?? REQUEST_TIMEOUT_MS;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        // Caller headers FIRST so the fixed auth/version headers always win - a
        // future adapter cannot accidentally clobber the bearer token.
        headers: {
          ...options?.headers,
          ...this.fixedHeaders(token),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          Accept: 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      const timedOut = controller.signal.aborted || (error as Error)?.name === 'AbortError';
      const message = timedOut
        ? `eparagony.pl ${method} ${path} timed out after ${timeoutMs}ms`
        : `eparagony.pl network error on ${method} ${path}: ${(error as Error)?.message ?? 'unknown'}`;
      if (idempotent) {
        throw new RetryableHttpError(message, 'transport', undefined, error);
      }
      throw new EparagonyNetworkError(message, error);
    } finally {
      clearTimeout(timeout);
    }

    const { text, truncated } = await this.readBodyBounded(response);

    if (!response.ok) {
      throw this.toResponseError(response, method, path, text, truncated, idempotent);
    }

    if (response.status === 204 || text.length === 0) {
      return { status: response.status, data: undefined as T };
    }
    try {
      return { status: response.status, data: JSON.parse(text) as T };
    } catch (error) {
      throw new EparagonyNetworkError(
        `eparagony.pl ${method} ${path} returned an unparseable response body`,
        error,
      );
    }
  }

  /**
   * Map a non-ok response onto the right error or retry marker.
   *
   * `429` and `5xx` are retryable in-request; both classify as `in-doubt` once
   * the budget is spent, because either may have been raised after the document
   * was created. Deterministic `4xx` responses go straight out as
   * `EparagonyApiError`, whose own constructor owns the rejected/in-doubt split.
   */
  private toResponseError(
    response: Response,
    method: EparagonyHttpMethod,
    path: string,
    text: string,
    truncated: boolean,
    idempotent: boolean,
  ): Error {
    const message = `eparagony.pl ${method} ${path} failed (${response.status})`;

    if (response.status === 429) {
      return new RetryableHttpError(
        message,
        'rate-limit',
        parseRetryAfterMs(response.headers.get('retry-after')),
      );
    }
    if (response.status >= 500) {
      return idempotent
        ? new RetryableHttpError(message, 'transport')
        : new EparagonyApiError(message, response.status, null);
    }
    // Never log the body: a vendor validation message quotes the submitted
    // document, which carries line names and buyer identifiers.
    this.logger.warn(`eparagony.pl ${method} ${path} -> ${response.status}`);
    return new EparagonyApiError(
      message,
      response.status,
      truncated ? null : parseErrorBody(text),
    );
  }

  private toExhaustedError(error: RetryableHttpError): Error {
    if (error.kind === 'rate-limit') {
      // A spent rate-limit budget is in-doubt, not a rejection: the vendor may
      // have accepted an earlier attempt whose response we never saw.
      return new EparagonyApiError(error.message, 429, null);
    }
    return new EparagonyNetworkError(error.message, error.retryCause);
  }

  // -------------------------------------------------------------------------
  // Token lifecycle
  // -------------------------------------------------------------------------

  private acquireToken(): Promise<string> {
    const cached = this.token;
    if (cached !== null && Date.now() < cached.refreshAfter) {
      return Promise.resolve(cached.accessToken);
    }
    // Collapse concurrent refreshes onto one round-trip. The vendor rate-limits
    // the token endpoint per IP, and a worker draining a queue would otherwise
    // stampede it.
    if (this.tokenInFlight !== null) {
      return this.tokenInFlight;
    }
    const inFlight = this.fetchToken().finally(() => {
      this.tokenInFlight = null;
    });
    this.tokenInFlight = inFlight;
    return inFlight;
  }

  private async fetchToken(): Promise<string> {
    const url = `${this.authBaseUrl}auth/token`;
    const form = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      scope: EPARAGONY_SCOPE_PARAM,
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'X-Api-Version': EPARAGONY_API_VERSION,
          'User-Agent': EPARAGONY_USER_AGENT,
          ...(this.config.integrationId === undefined
            ? {}
            : { 'X-Integration-Id': this.config.integrationId }),
        },
        body: form.toString(),
        signal: controller.signal,
      });
    } catch (error) {
      const timedOut = controller.signal.aborted || (error as Error)?.name === 'AbortError';
      throw new EparagonyNetworkError(
        timedOut
          ? `eparagony.pl token request timed out after ${REQUEST_TIMEOUT_MS}ms`
          : `eparagony.pl token request failed: ${(error as Error)?.message ?? 'unknown'}`,
        error,
      );
    } finally {
      clearTimeout(timeout);
    }

    const { text, truncated } = await this.readBodyBounded(response);
    if (!response.ok) {
      // Never echo the body - it can restate the submitted client_id.
      this.logger.warn(
        `eparagony.pl token request -> ${response.status} [connectionId=${this.config.connectionId}]`,
      );
      throw new EparagonyApiError(
        `eparagony.pl token request failed (${response.status})`,
        response.status,
        truncated ? null : parseErrorBody(text),
      );
    }

    let parsed: EparagonyTokenResponse;
    try {
      parsed = JSON.parse(text) as EparagonyTokenResponse;
    } catch (error) {
      throw new EparagonyNetworkError(
        'eparagony.pl token response was not valid JSON',
        error,
      );
    }

    const accessToken = typeof parsed.access_token === 'string' ? parsed.access_token.trim() : '';
    if (accessToken.length === 0) {
      throw new EparagonyApiError(
        'eparagony.pl token response carried no access_token',
        response.status,
        null,
        { failureMode: 'rejected', reason: 'The e-receipt provider issued no access token.' },
      );
    }

    // `expires_in` is documented as seconds and defaults to 3600. Tolerate a
    // missing, non-numeric or absurd value rather than throwing: an unusable
    // lifetime only costs an extra token round-trip.
    const lifetimeMs = readLifetimeMs(parsed.expires_in);
    this.token = {
      accessToken,
      refreshAfter: Date.now() + Math.max(lifetimeMs - TOKEN_REFRESH_MARGIN_MS, 0),
    };
    return accessToken;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private fixedHeaders(token: string): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      'X-Api-Version': EPARAGONY_API_VERSION,
      'User-Agent': EPARAGONY_USER_AGENT,
      ...(this.config.integrationId === undefined
        ? {}
        : { 'X-Integration-Id': this.config.integrationId }),
    };
  }

  private buildApiUrl(path: string): string {
    // Strip leading slashes so an absolute-looking path can neither drop the
    // base prefix nor (via `//host`) retarget the origin.
    const url = new URL(path.replace(/^\/+/, ''), this.apiBaseUrl);
    if (url.protocol !== 'https:' || url.origin !== this.apiOrigin) {
      throw new EparagonyConfigException(
        `eparagony.pl request path escaped the configured host (resolved origin "${url.origin}")`,
        'The e-receipt request was aimed outside the configured provider host.',
        this.config.connectionId,
      );
    }
    return url.toString();
  }

  private clampDelayMs(ms: number): number {
    return Math.min(Math.max(ms, 0), this.retryConfig.maxDelayMs);
  }

  private jitter(delayMs: number): number {
    // Full jitter over [delay/2, delay] - enough to de-synchronise a worker
    // fleet without ever waiting longer than the computed backoff.
    return Math.round(delayMs / 2 + Math.random() * (delayMs / 2));
  }

  /**
   * Read a response body bounded to `MAX_RESPONSE_BYTES`, reporting whether it
   * was truncated so the caller decides how to react. Falls back to
   * `response.text()` when the response exposes no stream (stubbed test doubles).
   */
  private async readBodyBounded(
    response: Response,
  ): Promise<{ text: string; truncated: boolean }> {
    const body = response.body;
    if (!body) {
      try {
        return { text: await response.text(), truncated: false };
      } catch {
        return { text: '', truncated: false };
      }
    }
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let total = 0;
    let truncated = false;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (!value) {
          continue;
        }
        total += value.byteLength;
        if (total > MAX_RESPONSE_BYTES) {
          truncated = true;
          break;
        }
        text += decoder.decode(value, { stream: true });
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    if (!truncated) {
      text += decoder.decode();
    }
    return { text, truncated };
  }
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function originOf(value: string, connectionId: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new EparagonyConfigException(
      `EparagonyHttpClient: invalid base URL "${value}"`,
      'The e-receipt connection has an invalid provider URL.',
      connectionId,
    );
  }
  if (parsed.protocol !== 'https:') {
    throw new EparagonyConfigException(
      `EparagonyHttpClient: base URL must be https, got "${parsed.protocol}"`,
      'The e-receipt connection must use an https provider URL.',
      connectionId,
    );
  }
  return parsed.origin;
}

/**
 * Parse an error body without assuming it is JSON. The vendor's own docs already
 * diverge from its published error list, so a non-JSON or unexpected body is a
 * normal case, not an exception.
 */
function parseErrorBody(text: string): EparagonyErrorBody | string | null {
  if (text.length === 0) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as EparagonyErrorBody;
    }
  } catch {
    // Fall through - a non-JSON body is kept as raw text.
  }
  return text;
}

function readLifetimeMs(expiresIn: unknown): number {
  const seconds = typeof expiresIn === 'number' ? expiresIn : Number(expiresIn);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return TOKEN_FALLBACK_LIFETIME_MS;
  }
  return seconds * 1000;
}

function parseRetryAfterMs(header: string | null): number | undefined {
  if (header === null) {
    return undefined;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const date = Date.parse(header);
  if (Number.isFinite(date)) {
    return Math.max(date - Date.now(), 0);
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
