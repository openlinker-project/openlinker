/**
 * Amazon SP-API HTTP Client
 *
 * Minimal native-`fetch` transport for the Selling Partner API: an LWA access
 * token in `x-amz-access-token`, a per-attempt timeout, typed errors carrying
 * Amazon's error code and request id. Constructed per resolution, never a DI
 * singleton, because it closes over one connection's token source and host.
 *
 * One exception to "no retries": a 401 means the access token was revoked or
 * rotated before its stated expiry. The client asks the token source to forget
 * it and sends the request once more with a fresh token. Amazon refused the
 * request before acting on it, so the repeat cannot double a write, and a second
 * 401 is surfaced as it is (the credentials themselves are then the problem).
 *
 * Otherwise deliberately has no retries, like `ShoperHttpClient`: a failed call surfaces
 * to the job, whose runner owns the retry ladder and defers a 429 / 503
 * penalty-free through the retry classifier. Back-off never reads
 * `x-amzn-RateLimit-Limit`: Amazon sends it only "when available" and warns
 * not to rely on it (#3741).
 *
 * Outbound pacing is the injected `fetchImpl`'s job: `createAmazonPacedFetch`
 * routes each operation group to its own bucket on `host.http`.
 * A rate-limiter rejection it throws is rethrown UNWRAPPED, so the runner can
 * requeue without spending an attempt.
 *
 * Safety properties, as in the Shoper client:
 *   - redirects are never followed, so the access token is never replayed to
 *     another host;
 *   - the response body is size-capped while it is read;
 *   - a 2xx that is not JSON is not an answer.
 *
 * @module libs/integrations/amazon/src/infrastructure/http
 */
import type { FetchLike } from '@openlinker/shared/http';
import { RateLimitAbortedError, RateLimitTimeoutError } from '@openlinker/shared/rate-limit';

import { AMAZON_USER_AGENT } from '../../amazon.constants';
import { AmazonApiError } from '../../domain/exceptions/amazon-api.error';
import { AmazonNetworkError } from '../../domain/exceptions/amazon-network.error';
import type { AmazonSpApiErrorBody } from '../../domain/types/amazon-api.types';
import type { AmazonAccessTokenSource } from './amazon-access-token.types';
import { parseAmazonJson, readAmazonBody } from './amazon-response-body';
import type { AmazonHttpMethod, AmazonQuery, AmazonSpApiResponse } from './amazon-spapi-client.types';

export type { AmazonHttpMethod, AmazonQuery, AmazonSpApiResponse } from './amazon-spapi-client.types';

const REQUEST_TIMEOUT_MS = 30_000;

export class AmazonSpApiClient {
  /**
   * `fetchImpl` is REQUIRED: a `?? globalThis.fetch` default would let a
   * forgotten wiring issue unpaced traffic no lint rule flags.
   */
  constructor(
    private readonly host: string,
    private readonly tokens: AmazonAccessTokenSource,
    private readonly fetchImpl: FetchLike,
  ) {}

  get<T>(path: string, query?: AmazonQuery): Promise<AmazonSpApiResponse<T>> {
    return this.request<T>('GET', path, query);
  }

  post<T>(path: string, body: unknown, query?: AmazonQuery): Promise<AmazonSpApiResponse<T>> {
    return this.request<T>('POST', path, query, body);
  }

  put<T>(path: string, body: unknown, query?: AmazonQuery): Promise<AmazonSpApiResponse<T>> {
    return this.request<T>('PUT', path, query, body);
  }

  patch<T>(path: string, body: unknown, query?: AmazonQuery): Promise<AmazonSpApiResponse<T>> {
    return this.request<T>('PATCH', path, query, body);
  }

  delete<T>(path: string, query?: AmazonQuery): Promise<AmazonSpApiResponse<T>> {
    return this.request<T>('DELETE', path, query);
  }

  private async request<T>(
    method: AmazonHttpMethod,
    path: string,
    query?: AmazonQuery,
    body?: unknown,
    refreshedAfter401 = false,
  ): Promise<AmazonSpApiResponse<T>> {
    const token = await this.tokens.getAccessToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    let text: string;
    try {
      response = await this.fetchImpl(buildAmazonUrl(this.host, path, query), {
        method,
        headers: {
          'x-amz-access-token': token,
          Accept: 'application/json',
          'User-Agent': AMAZON_USER_AGENT,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        redirect: 'manual',
        signal: controller.signal,
      });
      text = await readAmazonBody(response);
    } catch (error) {
      if (
        error instanceof RateLimitTimeoutError ||
        error instanceof RateLimitAbortedError ||
        error instanceof AmazonNetworkError
      ) {
        throw error;
      }
      const cause = error instanceof Error ? error : new Error(String(error));
      throw new AmazonNetworkError(
        controller.signal.aborted
          ? `Amazon request timed out after ${REQUEST_TIMEOUT_MS}ms`
          : `Amazon request failed: ${cause.message}`,
        controller.signal.aborted,
        cause,
      );
    } finally {
      clearTimeout(timer);
    }

    const requestId = response.headers.get('x-amzn-requestid') ?? undefined;
    const errorBody = response.status >= 400 ? parseAmazonJson<AmazonSpApiErrorBody>(text) : null;
    // Amazon answers a revoked, expired or malformed access token with 401 on
    // some hosts and with 403 "Unauthorized" on others (seen on the sandbox), so
    // both renew the token once. A 403 for a missing role carries the same code:
    // the retry then fails the same way and is surfaced, at the cost of one LWA call.
    const tokenRefused =
      response.status === 401 || (response.status === 403 && errorBody?.errors?.[0]?.code === 'Unauthorized');
    if (tokenRefused && !refreshedAfter401 && this.tokens.invalidate !== undefined) {
      await this.tokens.invalidate(token);
      return this.request<T>(method, path, query, body, true);
    }
    if (response.status < 200 || response.status >= 300) {
      const first = errorBody?.errors?.[0];
      throw new AmazonApiError(response.status, first?.code, first?.message, requestId);
    }

    // A delete or an accepted async write may answer 204 with no body.
    if (text.length === 0 && (response.status === 204 || method === 'DELETE')) {
      return { status: response.status, data: {} as T, requestId };
    }
    const data = parseAmazonJson<T>(text);
    if (data === null) {
      throw new AmazonNetworkError(`Amazon returned an unreadable response (HTTP ${response.status}, not JSON)`);
    }
    return { status: response.status, data, requestId };
  }
}

/** `https://{host}{path}?{query}`; list values comma-joined, `undefined` values dropped. */
export function buildAmazonUrl(host: string, path: string, query?: AmazonQuery): string {
  const normalisedPath = path.startsWith('/') ? path : `/${path}`;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) {
      continue;
    }
    params.append(key, Array.isArray(value) ? value.join(',') : String(value));
  }
  const search = params.toString();
  const base = /^https?:\/\//.test(host) ? host : `https://${host}`;
  return `${base}${normalisedPath}${search.length > 0 ? `?${search}` : ''}`;
}
