/**
 * Erli HTTP Client
 *
 * Native-`fetch` transport for the Erli Shop API v1 — the shared client every
 * Erli adapter (#984 offers, #993 orders) routes through. Mirrors the in-tree
 * precedent (`InpostHttpClient` / `AllegroHttpClient`; no axios). Attaches the
 * static Bearer API key, applies a jittered retry loop, enforces a request
 * timeout, and maps Erli error responses to typed domain exceptions.
 *
 * Keep-alive: pooling is provided transitively by the Node `fetch` runtime
 * (undici), which keep-alive-pools by default — no explicit agent/dispatcher
 * (Decision D1/D2). The client reuses one HTTP path across requests.
 *
 * Retry policy (Decision D3): `429` is always retried; `5xx`/network is retried
 * ONLY for idempotent requests (GET/PATCH, or POST flagged `idempotent: true`).
 * A non-idempotent POST fails fast on a transport error so a blind retry can't
 * double-create. The runner is the second retry tier (Decision D4); the typed
 * exceptions are the input to its `RetryClassifierPort` / `AuthFailureClassifierPort`.
 *
 * Construction: a plain class, instantiated PER CONNECTION inside the (#982)
 * `ErliAdapterFactory` — never `@Injectable`, never a DI singleton (it closes
 * over one connection's API key).
 *
 * @module libs/integrations/erli/src/infrastructure/http
 * @see {@link IErliHttpClient} for the port the adapters code against
 */
import { randomUUID } from 'node:crypto';
import { Logger } from '@openlinker/shared/logging';
import { ErliApiException } from '../../domain/exceptions/erli-api.exception';
import { ErliAuthenticationException } from '../../domain/exceptions/erli-authentication.exception';
import { ErliNetworkException } from '../../domain/exceptions/erli-network.exception';
import { ErliRateLimitException } from '../../domain/exceptions/erli-rate-limit.exception';
import type { IErliHttpClient } from './erli-http-client.interface';
import {
  DEFAULT_RETRY_CONFIG,
  type ErliHttpMethod,
  type ErliHttpResponse,
  type ErliRequestOptions,
  type RetryConfig,
} from './erli-http-client.types';

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Internal marker for a retryable transport failure. Never escapes the client —
 * the retry loop converts it to the right typed exception once the budget is
 * exhausted, discriminated by `kind`.
 */
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

export class ErliHttpClient implements IErliHttpClient {
  private readonly logger = new Logger(ErliHttpClient.name);
  private readonly retryConfig: RetryConfig;

  constructor(
    private readonly connectionId: string,
    private readonly baseUrl: string,
    private readonly apiKey: string,
    retryConfig?: Partial<RetryConfig>,
  ) {
    // Config guard: never let the bearer key leave over plaintext (Assumption 6).
    let protocol: string;
    try {
      protocol = new URL(baseUrl).protocol;
    } catch {
      throw new ErliApiException(`ErliHttpClient: invalid baseUrl "${baseUrl}"`);
    }
    if (protocol !== 'https:') {
      throw new ErliApiException(`ErliHttpClient: baseUrl must be https, got "${protocol}"`);
    }
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
  }

  get<T>(path: string, options?: ErliRequestOptions): Promise<ErliHttpResponse<T>> {
    return this.request<T>('GET', path, undefined, options);
  }

  post<T>(path: string, body?: unknown, options?: ErliRequestOptions): Promise<ErliHttpResponse<T>> {
    return this.request<T>('POST', path, body, options);
  }

  patch<T>(path: string, body?: unknown, options?: ErliRequestOptions): Promise<ErliHttpResponse<T>> {
    return this.request<T>('PATCH', path, body, options);
  }

  /**
   * Run one request through the retry loop. Retries only the internal
   * `RetryableHttpError` marker (429 always; idempotent 5xx/network), honoring
   * `Retry-After`, and converts an exhausted budget to the typed exception its
   * `kind` selects.
   */
  private async request<T>(
    method: ErliHttpMethod,
    path: string,
    body: unknown,
    options?: ErliRequestOptions,
  ): Promise<ErliHttpResponse<T>> {
    const requestId = randomUUID();
    // GET/PATCH are idempotent by HTTP semantics; POST only when opted in (D3).
    const idempotent = method !== 'POST' || options?.idempotent === true;
    let delay = this.retryConfig.initialDelayMs;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        return await this.executeOnce<T>(method, path, body, idempotent, options);
      } catch (error) {
        if (!(error instanceof RetryableHttpError)) {
          throw error;
        }
        if (attempt === this.retryConfig.maxRetries) {
          throw this.toExhaustedException(error, this.buildUrl(path, options?.queryParams));
        }
        const waitMs = error.retryAfterMs ?? this.jitter(delay);
        this.logger.warn(
          `Erli ${method} ${path} failed (attempt ${attempt + 1}/${this.retryConfig.maxRetries + 1}); retrying in ${waitMs}ms [connectionId=${this.connectionId} requestId=${requestId}]`,
        );
        await this.sleep(waitMs);
        delay = Math.min(delay * this.retryConfig.backoffMultiplier, this.retryConfig.maxDelayMs);
      }
    }

    // Unreachable: the final attempt either returns or throws above.
    throw new ErliNetworkException('Erli request exhausted its retry budget');
  }

  private async executeOnce<T>(
    method: ErliHttpMethod,
    path: string,
    body: unknown,
    idempotent: boolean,
    options?: ErliRequestOptions,
  ): Promise<ErliHttpResponse<T>> {
    const url = this.buildUrl(path, options?.queryParams);
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options?.timeoutMs ?? REQUEST_TIMEOUT_MS,
    );

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...options?.headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      const message = `Erli network error: ${(error as Error).message}`;
      // Transport failure: retry only if idempotent, else fail fast (D3).
      if (idempotent) {
        throw new RetryableHttpError(message, 'transport', undefined, error);
      }
      throw new ErliNetworkException(message, error);
    } finally {
      clearTimeout(timeout);
    }

    await this.throwIfNotOk(response, method, path, idempotent);

    if (response.status === 204) {
      return { status: response.status, data: undefined as T };
    }
    const text = await response.text();
    if (!text) {
      return { status: response.status, data: undefined as T };
    }
    try {
      return { status: response.status, data: JSON.parse(text) as T };
    } catch (error) {
      throw new ErliNetworkException('Erli returned an unparseable response body', error);
    }
  }

  /** Map a non-ok Erli response to the right exception/marker. No-op on ok. */
  private async throwIfNotOk(
    response: Response,
    method: ErliHttpMethod,
    path: string,
    idempotent: boolean,
  ): Promise<void> {
    if (response.ok) {
      return;
    }

    const url = this.buildUrl(path);
    const responseBody = await this.safeReadBody(response);
    const message = `Erli ${method} ${path} failed (${response.status})`;

    if (response.status === 401 || response.status === 403) {
      throw new ErliAuthenticationException(message, response.status, url);
    }
    if (response.status === 429) {
      throw new RetryableHttpError(
        message,
        'rate-limit',
        parseRetryAfterMs(response.headers.get('retry-after')),
      );
    }
    if (response.status >= 500) {
      // Transport-class failure: retry only if idempotent, else fail fast (D3).
      if (idempotent) {
        throw new RetryableHttpError(message, 'transport');
      }
      throw new ErliNetworkException(message);
    }
    // Deterministic 4xx — non-retryable.
    throw new ErliApiException(message, response.status, responseBody, url);
  }

  private toExhaustedException(error: RetryableHttpError, url: string): Error {
    return error.kind === 'rate-limit'
      ? new ErliRateLimitException(error.message, error.retryAfterMs, url)
      : new ErliNetworkException(error.message, error.retryCause);
  }

  private buildUrl(path: string, queryParams?: ErliRequestOptions['queryParams']): string {
    const url = new URL(path, this.baseUrl);
    if (queryParams) {
      for (const [key, value] of Object.entries(queryParams)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private async safeReadBody(response: Response): Promise<string | undefined> {
    try {
      const text = await response.text();
      return text === '' ? undefined : text;
    } catch {
      return undefined;
    }
  }

  private jitter(delayMs: number): number {
    return Math.round(delayMs * (0.5 + Math.random() * 0.5));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Parse a `Retry-After` header to ms. Erli sends the numeric-seconds form; the
 * HTTP-date form (or any non-finite value) yields `undefined` so the caller
 * falls back to jittered backoff — never `NaN` into `setTimeout`.
 */
function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) {
    return undefined;
  }
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}
