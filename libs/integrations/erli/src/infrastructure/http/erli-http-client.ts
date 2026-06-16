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
 * @see {@link IErliHttpClient} for the transport interface the adapters code against
 */
import { randomUUID } from 'node:crypto';
import { Logger } from '@openlinker/shared/logging';
import { ErliApiException } from '../../domain/exceptions/erli-api.exception';
import { ErliAuthenticationException } from '../../domain/exceptions/erli-authentication.exception';
import { ErliConfigException } from '../../domain/exceptions/erli-config.exception';
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

// Per-ATTEMPT timeout, not a whole-call deadline: an idempotent request can be
// re-issued up to `maxRetries` times, so worst-case wall-clock is roughly
// `(maxRetries + 1) × REQUEST_TIMEOUT_MS` plus backoff. The host runner (D4) is
// the outer time-bound tier.
const REQUEST_TIMEOUT_MS = 30_000;

// Hard ceiling on a buffered response body. The per-request timeout bounds
// *time* but not *bytes*; a buggy or hostile upstream streaming an unbounded
// body would otherwise exhaust worker memory. Erli's JSON payloads are tiny —
// 8 MiB is generous headroom while still capping the blast radius.
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

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
  /** Base URL normalized to a trailing slash so a path prefix survives joins. */
  private readonly baseUrl: string;
  /** Expected origin; every resolved per-request URL is re-checked against it. */
  private readonly baseOrigin: string;

  constructor(
    private readonly connectionId: string,
    baseUrl: string,
    private readonly apiKey: string,
    retryConfig?: Partial<RetryConfig>,
  ) {
    // Config guard: never let the bearer key leave over plaintext (Assumption 6).
    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
    } catch {
      throw new ErliConfigException(`ErliHttpClient: invalid baseUrl "${baseUrl}"`, connectionId);
    }
    if (parsed.protocol !== 'https:') {
      throw new ErliConfigException(
        `ErliHttpClient: baseUrl must be https, got "${parsed.protocol}"`,
        connectionId,
      );
    }
    // Trailing slash so `new URL('offers', base)` keeps a path prefix like
    // `/svc/shop-api` instead of resolving it away to the host root.
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    this.baseOrigin = parsed.origin;
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
    // Resolve (and host-escape-guard) the URL once: `path`/`queryParams` are
    // fixed across attempts, so a path that escapes the host fails fast here —
    // before the first fetch — and every attempt reuses the same string.
    const url = this.buildUrl(path, options?.queryParams);
    let delay = this.retryConfig.initialDelayMs;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        return await this.executeOnce<T>(method, path, url, body, idempotent, options);
      } catch (error) {
        if (!(error instanceof RetryableHttpError)) {
          throw error;
        }
        if (attempt === this.retryConfig.maxRetries) {
          throw this.toExhaustedException(error, url);
        }
        // Honor server `Retry-After`, but clamp to `maxDelayMs` so a hostile or
        // buggy upstream can't stall a worker on an absurd backoff.
        const waitMs =
          error.retryAfterMs !== undefined
            ? this.clampDelayMs(error.retryAfterMs)
            : this.jitter(delay);
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
    url: string,
    body: unknown,
    idempotent: boolean,
    options?: ErliRequestOptions,
  ): Promise<ErliHttpResponse<T>> {
    const timeoutMs = options?.timeoutMs ?? REQUEST_TIMEOUT_MS;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        // Caller headers first so the fixed auth/content headers always win —
        // a future adapter can't accidentally clobber the bearer key.
        headers: {
          ...options?.headers,
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      // Distinguish a timeout (our AbortController fired) from a genuine
      // transport failure — the message feeds the host RetryClassifier.
      const message =
        (error as Error)?.name === 'AbortError'
          ? `Erli ${method} ${path} timed out after ${timeoutMs}ms`
          : `Erli network error: ${(error as Error).message}`;
      // Transport failure: retry only if idempotent, else fail fast (D3).
      if (idempotent) {
        throw new RetryableHttpError(message, 'transport', undefined, error);
      }
      throw new ErliNetworkException(message, error);
    } finally {
      clearTimeout(timeout);
    }

    await this.throwIfNotOk(response, method, path, url, idempotent);

    if (response.status === 204) {
      return { status: response.status, data: undefined as T };
    }
    const { text, truncated } = await this.readBodyBounded(response);
    if (truncated) {
      throw new ErliNetworkException(
        `Erli response body exceeded the ${MAX_RESPONSE_BYTES}-byte ceiling`,
      );
    }
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
    url: string,
    idempotent: boolean,
  ): Promise<void> {
    if (response.ok) {
      return;
    }

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
      ? new ErliRateLimitException(
          error.message,
          // Clamp before it escapes: the host RetryClassifier (D4) reads this
          // hint, so an absurd upstream `Retry-After` must not survive onto the
          // exception and schedule a multi-year re-run.
          error.retryAfterMs !== undefined ? this.clampDelayMs(error.retryAfterMs) : undefined,
          url,
        )
      : new ErliNetworkException(error.message, error.retryCause);
  }

  /**
   * Clamp a delay to `[0, maxDelayMs]`. Shared by the in-loop backoff wait and
   * the `Retry-After` hint carried on an exhausted `ErliRateLimitException`, so
   * neither a worker thread nor the host runner can be stalled by a hostile or
   * buggy upstream backoff value.
   */
  private clampDelayMs(ms: number): number {
    return Math.min(Math.max(ms, 0), this.retryConfig.maxDelayMs);
  }

  private buildUrl(path: string, queryParams?: ErliRequestOptions['queryParams']): string {
    // Strip leading slashes so an absolute-looking path can neither drop the
    // base prefix nor (via `//host`) retarget the origin — the join stays
    // relative to the configured base.
    const url = new URL(path.replace(/^\/+/, ''), this.baseUrl);
    // Defense in depth: a resolved URL that escaped the host or downgraded the
    // scheme must never carry the bearer key. Re-assert the construction guard
    // per request, since `path` is the one caller-varying input.
    if (url.protocol !== 'https:' || url.origin !== this.baseOrigin) {
      throw new ErliConfigException(
        `ErliHttpClient: request path escaped the configured host (resolved origin "${url.origin}")`,
        this.connectionId,
      );
    }
    if (queryParams) {
      for (const [key, value] of Object.entries(queryParams)) {
        if (value === undefined) {
          continue;
        }
        // Arrays append one repeated param per element (e.g. the `status[]`-style
        // list filters the #993 orders feed needs); scalars set a single value.
        if (Array.isArray(value)) {
          for (const item of value) {
            if (item !== undefined) {
              url.searchParams.append(key, String(item));
            }
          }
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private async safeReadBody(response: Response): Promise<string | undefined> {
    try {
      // Bounded read on the error path too: a truncated diagnostic body is
      // fine, an unbounded one is the same DoS vector as the success path.
      const { text } = await this.readBodyBounded(response);
      return text === '' ? undefined : text;
    } catch {
      return undefined;
    }
  }

  /**
   * Read a response body bounded to `MAX_RESPONSE_BYTES`. Streams via the
   * `ReadableStream` reader and stops at the ceiling (cancelling the stream so
   * the socket is released), reporting `truncated` so the caller decides how to
   * react — the success path rejects, the diagnostic path keeps the prefix.
   * Falls back to `response.text()` when no stream is present (e.g. a stubbed
   * test response).
   */
  private async readBodyBounded(response: Response): Promise<{ text: string; truncated: boolean }> {
    const body = response.body;
    if (!body) {
      return { text: await response.text(), truncated: false };
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
