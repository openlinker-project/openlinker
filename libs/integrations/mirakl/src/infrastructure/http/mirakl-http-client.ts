/**
 * Mirakl HTTP Client
 *
 * Native-`fetch` transport for the Mirakl Seller API, shared by every Mirakl
 * adapter. Same shape as `ErliHttpClient` (retry loop, per-attempt timeout,
 * bounded body, host-escape guard, typed exceptions), with the differences the
 * Mirakl API needs:
 *
 * - **Auth.** `Authorization: <key>`, no `Bearer` prefix (verified on Empik
 *   staging).
 * - **Shop scoping.** When the connection names a shop, every request carries
 *   `shop_id`, so a key with access to several shops always acts on the chosen
 *   one.
 * - **Two error shapes.** `{ code, message, status }` and `{ message, status }`
 *   both map to `MiraklApiException`; `miraklCode` is set only when present.
 * - **File uploads.** The CSV imports are `multipart/form-data` and are never
 *   retried on 5xx or a transport failure (a second submit could apply twice).
 * - **Text bodies.** Import error reports are CSV, read through `getText`.
 *
 * Retry policy: 429 is always retried (honouring `Retry-After`, clamped); 5xx
 * and transport failures only for idempotent requests (GET, PUT, or POST marked
 * `idempotent`). The sync runner is the second retry tier.
 *
 * Constructed per connection by `MiraklAdapterFactory`; never a DI singleton,
 * because it closes over one connection's key.
 *
 * @module libs/integrations/mirakl/src/infrastructure/http
 * @see {@link IMiraklHttpClient}
 */
import { randomUUID } from 'node:crypto';
import { Logger } from '@openlinker/shared/logging';
import type { FetchLike } from '@openlinker/shared/http';
import { MiraklApiException } from '../../domain/exceptions/mirakl-api.exception';
import { MiraklAuthenticationException } from '../../domain/exceptions/mirakl-authentication.exception';
import { MiraklConfigException } from '../../domain/exceptions/mirakl-config.exception';
import { MiraklNetworkException } from '../../domain/exceptions/mirakl-network.exception';
import { MiraklRateLimitException } from '../../domain/exceptions/mirakl-rate-limit.exception';
import type { IMiraklHttpClient } from './mirakl-http-client.interface';
import {
  DEFAULT_RETRY_CONFIG,
  type MiraklFileUpload,
  type MiraklHttpMethod,
  type MiraklHttpResponse,
  type MiraklRequestOptions,
  type RetryConfig,
} from './mirakl-http-client.types';

/** Per-attempt timeout; the runner bounds the whole job. */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Ceiling on a buffered response body. Ordinary Mirakl responses are small,
 * but some lists are not: the unfiltered value-list endpoint (VL11) returned
 * 183 MB on Empik staging. Callers filter those; this cap turns a forgotten
 * filter into a clear error instead of an out-of-memory worker.
 */
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

/** What a single request sends. */
type RequestBody =
  | { readonly kind: 'none' }
  | { readonly kind: 'json'; readonly value: unknown }
  | { readonly kind: 'file'; readonly file: MiraklFileUpload };

type ResponseFormat = 'json' | 'text';

/** A retryable failure; never escapes the client. */
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

/** Mirakl's JSON error body, in either of its two shapes. */
interface MiraklErrorBody {
  code?: unknown;
  message?: unknown;
}

export class MiraklHttpClient implements IMiraklHttpClient {
  private readonly logger = new Logger(MiraklHttpClient.name);
  private readonly retryConfig: RetryConfig;
  private readonly baseUrl: string;
  private readonly baseOrigin: string;

  /**
   * `fetchImpl` is required on purpose, as in `ErliHttpClient`: every request
   * must go through the connection-bound transport so the connection's rate
   * limit cannot be bypassed by a forgotten wiring.
   */
  constructor(
    private readonly connectionId: string,
    baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike,
    private readonly shopId?: string,
    retryConfig?: Partial<RetryConfig>,
  ) {
    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
    } catch {
      throw new MiraklConfigException(`MiraklHttpClient: invalid baseUrl "${baseUrl}"`, connectionId);
    }
    if (parsed.protocol !== 'https:') {
      throw new MiraklConfigException(
        `MiraklHttpClient: baseUrl must be https, got "${parsed.protocol}"`,
        connectionId,
      );
    }
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    this.baseOrigin = parsed.origin;
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
  }

  get<T>(path: string, options?: MiraklRequestOptions): Promise<MiraklHttpResponse<T>> {
    return this.request<T>('GET', path, { kind: 'none' }, 'json', options);
  }

  getText(path: string, options?: MiraklRequestOptions): Promise<MiraklHttpResponse<string>> {
    return this.request<string>('GET', path, { kind: 'none' }, 'text', options);
  }

  post<T>(path: string, body?: unknown, options?: MiraklRequestOptions): Promise<MiraklHttpResponse<T>> {
    return this.request<T>('POST', path, toJsonBody(body), 'json', options);
  }

  put<T>(path: string, body?: unknown, options?: MiraklRequestOptions): Promise<MiraklHttpResponse<T>> {
    return this.request<T>('PUT', path, toJsonBody(body), 'json', options);
  }

  postFile<T>(
    path: string,
    file: MiraklFileUpload,
    options?: MiraklRequestOptions,
  ): Promise<MiraklHttpResponse<T>> {
    return this.request<T>('POST', path, { kind: 'file', file }, 'json', options);
  }

  private async request<T>(
    method: MiraklHttpMethod,
    path: string,
    body: RequestBody,
    format: ResponseFormat,
    options?: MiraklRequestOptions,
  ): Promise<MiraklHttpResponse<T>> {
    const requestId = randomUUID();
    const idempotent =
      body.kind !== 'file' && (method !== 'POST' || options?.idempotent === true);
    const url = this.buildUrl(path, options?.queryParams);
    let delay = this.retryConfig.initialDelayMs;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        return await this.executeOnce<T>(method, path, url, body, format, idempotent, options);
      } catch (error) {
        if (!(error instanceof RetryableHttpError)) {
          throw error;
        }
        if (attempt === this.retryConfig.maxRetries) {
          throw this.toExhaustedException(error, url);
        }
        const waitMs =
          error.retryAfterMs !== undefined ? this.clampDelayMs(error.retryAfterMs) : this.jitter(delay);
        this.logger.warn(
          `Mirakl ${method} ${path} failed (attempt ${attempt + 1}/${this.retryConfig.maxRetries + 1}); retrying in ${waitMs}ms [connectionId=${this.connectionId} requestId=${requestId}]`,
        );
        await this.sleep(waitMs);
        delay = Math.min(delay * this.retryConfig.backoffMultiplier, this.retryConfig.maxDelayMs);
      }
    }

    throw new MiraklNetworkException('Mirakl request exhausted its retry budget');
  }

  private async executeOnce<T>(
    method: MiraklHttpMethod,
    path: string,
    url: string,
    body: RequestBody,
    format: ResponseFormat,
    idempotent: boolean,
    options?: MiraklRequestOptions,
  ): Promise<MiraklHttpResponse<T>> {
    const timeoutMs = options?.timeoutMs ?? REQUEST_TIMEOUT_MS;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: this.buildHeaders(body, format),
        body: this.buildBody(body),
        signal: controller.signal,
      });
    } catch (error) {
      const timedOut = controller.signal.aborted || (error as Error)?.name === 'AbortError';
      const message = timedOut
        ? `Mirakl ${method} ${path} timed out after ${timeoutMs}ms`
        : `Mirakl network error: ${(error as Error).message}`;
      if (idempotent) {
        throw new RetryableHttpError(message, 'transport', undefined, error);
      }
      throw new MiraklNetworkException(message, error);
    } finally {
      clearTimeout(timeout);
    }

    await this.throwIfNotOk(response, method, path, url, idempotent);

    if (response.status === 204) {
      return { status: response.status, data: undefined as T };
    }
    const { text, truncated } = await this.readBodyBounded(response);
    if (truncated) {
      throw new MiraklNetworkException(
        `Mirakl response body exceeded the ${MAX_RESPONSE_BYTES}-byte ceiling (${method} ${path})`,
      );
    }
    if (format === 'text') {
      return { status: response.status, data: text as T };
    }
    if (!text) {
      return { status: response.status, data: undefined as T };
    }
    try {
      return { status: response.status, data: JSON.parse(text) as T };
    } catch (error) {
      throw new MiraklNetworkException('Mirakl returned an unparseable response body', error);
    }
  }

  private buildHeaders(body: RequestBody, format: ResponseFormat): Record<string, string> {
    return {
      // No `Bearer`: Mirakl takes the shop key as the whole header value.
      Authorization: this.apiKey,
      Accept: format === 'text' ? 'text/csv, text/plain, */*' : 'application/json',
      // A multipart body sets its own Content-Type with the boundary.
      ...(body.kind === 'json' ? { 'Content-Type': 'application/json' } : {}),
    };
  }

  private buildBody(body: RequestBody): string | FormData | undefined {
    switch (body.kind) {
      case 'none':
        return undefined;
      case 'json':
        return JSON.stringify(body.value);
      case 'file': {
        const form = new FormData();
        form.append(
          body.file.fieldName,
          new Blob([body.file.content], { type: body.file.contentType }),
          body.file.fileName,
        );
        for (const [name, value] of Object.entries(body.file.fields ?? {})) {
          form.append(name, value);
        }
        return form;
      }
    }
  }

  private async throwIfNotOk(
    response: Response,
    method: MiraklHttpMethod,
    path: string,
    url: string,
    idempotent: boolean,
  ): Promise<void> {
    if (response.ok) {
      return;
    }
    const message = `Mirakl ${method} ${path} failed (${response.status})`;

    if (response.status === 401 || response.status === 403) {
      throw new MiraklAuthenticationException(message, response.status, url);
    }
    if (response.status === 429) {
      throw new RetryableHttpError(
        message,
        'rate-limit',
        parseRetryAfterMs(response.headers.get('retry-after')),
      );
    }
    if (response.status >= 500) {
      if (idempotent) {
        throw new RetryableHttpError(message, 'transport');
      }
      throw new MiraklNetworkException(message);
    }
    const responseBody = await this.safeReadBody(response);
    const parsed = parseErrorBody(responseBody);
    throw new MiraklApiException(
      parsed.code ? `${message}: ${parsed.code}` : message,
      response.status,
      parsed.code,
      parsed.message,
      responseBody,
      url,
    );
  }

  private toExhaustedException(error: RetryableHttpError, url: string): Error {
    return error.kind === 'rate-limit'
      ? new MiraklRateLimitException(
          error.message,
          error.retryAfterMs !== undefined ? this.clampDelayMs(error.retryAfterMs) : undefined,
          url,
        )
      : new MiraklNetworkException(error.message, error.retryCause);
  }

  private clampDelayMs(ms: number): number {
    return Math.min(Math.max(ms, 0), this.retryConfig.maxDelayMs);
  }

  private buildUrl(path: string, queryParams?: MiraklRequestOptions['queryParams']): string {
    const url = new URL(path.replace(/^\/+/, ''), this.baseUrl);
    // The key must never leave over cleartext or to another host; `path` is the
    // one caller-varying input, so re-check every request.
    if (url.protocol !== 'https:' || url.origin !== this.baseOrigin) {
      throw new MiraklConfigException(
        `MiraklHttpClient: request path escaped the configured host (resolved origin "${url.origin}")`,
        this.connectionId,
      );
    }
    if (queryParams) {
      for (const [key, value] of Object.entries(queryParams)) {
        if (value === undefined) {
          continue;
        }
        if (Array.isArray(value)) {
          for (const item of value as ReadonlyArray<string | number | boolean>) {
            url.searchParams.append(key, String(item));
          }
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }
    if (this.shopId !== undefined && !url.searchParams.has('shop_id')) {
      url.searchParams.set('shop_id', this.shopId);
    }
    return url.toString();
  }

  private async safeReadBody(response: Response): Promise<string | undefined> {
    try {
      const { text } = await this.readBodyBounded(response);
      return text === '' ? undefined : text;
    } catch {
      return undefined;
    }
  }

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

function toJsonBody(body: unknown): RequestBody {
  return body === undefined ? { kind: 'none' } : { kind: 'json', value: body };
}

/**
 * Read `code` and `message` from a Mirakl error body. Either may be absent;
 * a body that is not JSON yields neither.
 */
export function parseErrorBody(body: string | undefined): { code?: string; message?: string } {
  if (!body) {
    return {};
  }
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return {};
  }
  if (typeof value !== 'object' || value === null) {
    return {};
  }
  const { code, message } = value as MiraklErrorBody;
  return {
    code: typeof code === 'string' && code.length > 0 ? code : undefined,
    message: typeof message === 'string' && message.length > 0 ? message : undefined,
  };
}

/**
 * Parse `Retry-After` to ms. Mirakl sends seconds; an HTTP-date or anything
 * non-numeric yields `undefined`, so the caller falls back to jittered backoff.
 */
function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) {
    return undefined;
  }
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}
