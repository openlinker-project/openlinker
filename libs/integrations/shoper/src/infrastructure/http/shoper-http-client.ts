/**
 * Shoper HTTP Client
 *
 * Minimal native-`fetch` transport for the Shoper REST API: Bearer auth, a
 * per-attempt timeout, typed errors. Construction is PER CALL SITE (the
 * connection tester today) and never a DI singleton, because it closes over
 * one connection's token.
 *
 * Deliberately has no retries and no rate limiting yet. Both belong with the
 * first capability that makes authenticated calls from a worker: the real
 * request ceiling is unconfirmed (SPIKE-3638 C6), and a retry on the
 * connection test would mask real latency and make auth failures harder to
 * diagnose. Outbound pacing is the injected `fetchImpl`'s job - callers pass
 * `host.http.forConnection(connection)`.
 *
 * Two safety properties are load-bearing:
 *   - **Redirects are never followed.** The Bearer token must not be replayed
 *     to a host the operator did not configure, and a 3xx from a shop is an
 *     error anyway.
 *   - **The response is size-capped, while it is read.** A timeout bounds time,
 *     not bytes, and `response.text()` buffers everything before it can be
 *     measured, so the body is consumed as a stream, bytes are counted (not
 *     UTF-16 units) and the reader is cancelled once past the ceiling - which
 *     also holds for a chunked response that declares no `content-length`.
 *
 * @module libs/integrations/shoper/src/infrastructure/http
 */
import type { FetchLike } from '@openlinker/shared/http';

import { buildShoperApiUrl } from '../../domain/policies/shoper-base-url.policy';
import { ShoperApiError } from '../../domain/exceptions/shoper-api.error';
import { ShoperNetworkError } from '../../domain/exceptions/shoper-network.error';
import type { ShoperErrorBody } from '../../domain/types/shoper-api.types';

/** Per-attempt timeout. */
const REQUEST_TIMEOUT_MS = 15_000;

/** Hard ceiling on a buffered response body. */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export interface ShoperHttpClientConfig {
  /** Normalised shop host from `parseShoperBaseUrl`. */
  readonly host: string;
  readonly token: string;
}

export interface ShoperHttpResponse<T> {
  readonly status: number;
  readonly data: T;
}

/**
 * Query parameters of a request. Keys may carry Shoper's bracket syntax
 * (`filters[product_id]`); both keys and values are percent-encoded, which the
 * live API accepts (verified against the trial shop).
 */
export type ShoperQuery = Readonly<Record<string, string | number>>;

function encodeQuery(query: ShoperQuery | undefined): string {
  if (query === undefined) {
    return '';
  }
  const pairs = Object.entries(query).map(
    ([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
  );
  return pairs.length > 0 ? `?${pairs.join('&')}` : '';
}

export class ShoperHttpClient {
  /**
   * `fetchImpl` is **required**, deliberately: an optional `?? globalThis.fetch`
   * default would let a forgotten wiring issue unpaced traffic that neither the
   * `no-restricted-globals` rule nor `check-outbound-http.mjs` would flag.
   */
  constructor(
    private readonly config: ShoperHttpClientConfig,
    private readonly fetchImpl: FetchLike
  ) {}

  async get<T>(path: string, query?: ShoperQuery): Promise<ShoperHttpResponse<T>> {
    return this.request<T>('GET', path, query);
  }

  /** JSON write. Same safety properties as `get`: no redirects, capped body, timeout. */
  async put(path: string, body: unknown): Promise<ShoperHttpResponse<unknown>> {
    // `unknown`: the shape of Shoper's PUT answer is not confirmed on a live shop.
    return this.request<unknown>('PUT', path, undefined, body);
  }

  private async request<T>(
    method: 'GET' | 'PUT',
    path: string,
    query?: ShoperQuery,
    body?: unknown,
  ): Promise<ShoperHttpResponse<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    let text: string;
    try {
      response = await this.fetchImpl(buildShoperApiUrl(this.config.host, path) + encodeQuery(query), {
        method,
        headers: {
          Authorization: `Bearer ${this.config.token}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        redirect: 'manual',
        signal: controller.signal,
      });
      text = await this.readBody(response);
    } catch (error) {
      throw this.toNetworkError(error, controller.signal.aborted);
    } finally {
      clearTimeout(timer);
    }

    if (response.status < 200 || response.status >= 300) {
      const errorBody = parseJson<ShoperErrorBody>(text);
      throw new ShoperApiError(response.status, errorBody?.error, errorBody?.error_description);
    }

    // A 2xx whose body is empty or not JSON is NOT an answer: a parked domain or
    // a catch-all page would otherwise read as `{}` and look like a Shoper shop.
    const data = parseJson<T>(text);
    if (data === null) {
      throw new ShoperNetworkError(
        `Shoper returned an unreadable response (HTTP ${response.status}, not JSON)`
      );
    }
    return { status: response.status, data };
  }

  private async readBody(response: Response): Promise<string> {
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
      throw new ShoperNetworkError(
        `Shoper response is larger than the ${MAX_RESPONSE_BYTES}-byte limit`
      );
    }
    if (response.body === null) {
      return '';
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let received = 0;
    let text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        return text + decoder.decode();
      }
      received += value.byteLength;
      if (received > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new ShoperNetworkError(
          `Shoper response is larger than the ${MAX_RESPONSE_BYTES}-byte limit`
        );
      }
      text += decoder.decode(value, { stream: true });
    }
  }

  private toNetworkError(error: unknown, timedOut: boolean): ShoperNetworkError {
    if (error instanceof ShoperNetworkError) {
      return error;
    }
    const cause = error instanceof Error ? error : new Error(String(error));
    return new ShoperNetworkError(
      timedOut
        ? `Shoper request timed out after ${REQUEST_TIMEOUT_MS}ms`
        : `Shoper request failed: ${cause.message}`,
      timedOut,
      cause
    );
  }
}

function parseJson<T>(text: string): T | null {
  if (text.length === 0) {
    return null;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
