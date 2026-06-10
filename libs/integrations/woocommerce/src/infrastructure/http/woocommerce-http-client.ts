/**
 * WooCommerce HTTP Client
 *
 * Native-`fetch` transport for the WooCommerce REST API v3. Attaches Basic
 * Auth credentials (consumer key + consumer secret, Base64-encoded) on every
 * request, serialises optional query params, and enforces a request timeout
 * via `AbortController`.
 *
 * Retry loop: exponential backoff for 429 and 5xx responses. Non-retryable
 * status codes (401, 403, 404) throw typed domain exceptions immediately.
 *
 * SSRF redirect guard (#969): the config-time `IsSsrfSafeUrlConstraint` only
 * validates the configured `siteUrl`. `fetch` follows redirects by default, so
 * a validated https store URL could be 302'd to `http://10.0.0.5` at request
 * time. We therefore use `redirect: 'manual'` and re-check every 3xx
 * `Location` with the SAME canonical host-safety predicate before following
 * it — a private/link-local/cleartext target is rejected, not followed.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/http
 */
import type { RetryConfig } from './woocommerce-http-client.types';
import type { IWooCommerceHttpClient } from './woocommerce-http-client.interface';
import { WooCommerceUnauthorizedException } from '../../domain/exceptions/woocommerce-unauthorized.exception';
import { WooCommerceNetworkException } from '../../domain/exceptions/woocommerce-network.exception';
import { WooCommerceHttpResponseException } from './woocommerce-http-response.exception';
import { isUrlSsrfSafe } from './woocommerce-url-safety';

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 500,
  backoffMultiplier: 2,
  maxDelayMs: 8000,
};

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Hard cap on redirect-follow depth — bounds a redirect loop and matches the
 * browser/Node default (20). WC stores legitimately redirect at most once or
 * twice (e.g. http→https upgrade handled upstream, trailing-slash canonicalise).
 */
const MAX_REDIRECTS = 5;

export class WooCommerceHttpClient implements IWooCommerceHttpClient {
  private readonly siteUrl: string;
  private readonly retryConfig: RetryConfig;

  constructor(
    siteUrl: string,
    private readonly consumerKey: string,
    private readonly consumerSecret: string,
    retryConfig?: Partial<RetryConfig>,
  ) {
    this.siteUrl = siteUrl.replace(/\/+$/, '');
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
  }

  async get<T>(path: string, params?: Record<string, string | number | boolean>): Promise<T> {
    const qs = params
      ? new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()
      : '';
    const separator = qs ? (path.includes('?') ? '&' : '?') : '';
    const url = `${this.siteUrl}${path}${separator}${qs}`;
    return this.request<T>('GET', url);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.siteUrl}${path}`;
    return this.request<T>('POST', url, body);
  }

  async put<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.siteUrl}${path}`;
    return this.request<T>('PUT', url, body);
  }

  async delete<T>(path: string, params?: Record<string, string | number | boolean>): Promise<T> {
    const qs = params
      ? new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString()
      : '';
    const separator = qs ? (path.includes('?') ? '&' : '?') : '';
    const url = `${this.siteUrl}${path}${separator}${qs}`;
    return this.request<T>('DELETE', url);
  }

  private async request<T>(
    method: string,
    url: string,
    body?: unknown,
    redirectCount = 0,
  ): Promise<T> {
    let delay = this.retryConfig.initialDelayMs;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      try {
        const headers: Record<string, string> = {
          Authorization: this.buildAuthHeader(),
          Accept: 'application/json',
        };
        if (body !== undefined) {
          headers['Content-Type'] = 'application/json';
        }

        const response = await fetch(url, {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: controller.signal,
          // Do NOT auto-follow — re-check each redirect target for SSRF (#969).
          redirect: 'manual',
        });

        // 3xx with a Location — SSRF-guard the target before following it.
        if (response.status >= 300 && response.status < 400) {
          return this.followRedirect<T>(response, method, url, body, redirectCount);
        }

        if (response.ok) {
          return (await response.json()) as T;
        }

        // Never retry auth errors or not-found
        if (response.status === 401 || response.status === 403) {
          throw new WooCommerceUnauthorizedException(
            `WooCommerce authentication failed (HTTP ${response.status})`,
          );
        }

        // WC encodes a machine-readable `code` (e.g. `product_invalid_sku`) in
        // the error body; surface it so the adapter can map known codes to
        // domain exceptions.
        const errorCode = await this.extractErrorCode(response);

        if (response.status === 404) {
          throw new WooCommerceHttpResponseException(
            response.status,
            `WooCommerce returned HTTP ${response.status}: ${url}`,
            errorCode,
          );
        }

        // Only retry 429 (rate limit) and 5xx (server errors)
        const isRetryable = response.status === 429 || response.status >= 500;
        if (isRetryable && attempt < this.retryConfig.maxRetries) {
          await this.sleep(Math.min(delay, this.retryConfig.maxDelayMs));
          delay *= this.retryConfig.backoffMultiplier;
          continue;
        }

        // Distinguish "retries exhausted" (we actually retried) from a
        // non-retryable status (4xx other than auth/404) that never retried —
        // the message must not claim retries that did not happen.
        const message = isRetryable
          ? `WooCommerce returned HTTP ${response.status} after ${this.retryConfig.maxRetries} retries`
          : `WooCommerce returned HTTP ${response.status}`;
        throw new WooCommerceHttpResponseException(response.status, message, errorCode);
      } catch (err) {
        if (
          err instanceof WooCommerceUnauthorizedException ||
          err instanceof WooCommerceHttpResponseException ||
          err instanceof WooCommerceNetworkException
        ) {
          throw err;
        }

        if ((err as { name?: string }).name === 'AbortError') {
          throw new WooCommerceNetworkException('WooCommerce request timed out', err as Error);
        }

        if (attempt < this.retryConfig.maxRetries) {
          await this.sleep(Math.min(delay, this.retryConfig.maxDelayMs));
          delay *= this.retryConfig.backoffMultiplier;
          continue;
        }

        throw new WooCommerceNetworkException(
          `WooCommerce network error after ${this.retryConfig.maxRetries} retries`,
          err as Error,
        );
      } finally {
        clearTimeout(timeout);
      }
    }

    // Unreachable — loop always throws or returns
    throw new WooCommerceNetworkException('WooCommerce request failed');
  }

  /**
   * Validates a 3xx redirect target and re-issues the request against it.
   * Rejects (does not follow) a `Location` that is missing, exceeds the
   * redirect cap, is not https (cleartext would leak Basic-Auth credentials),
   * or whose host is SSRF-unsafe (private / link-local / cloud-metadata).
   */
  private async followRedirect<T>(
    response: Response,
    method: string,
    fromUrl: string,
    body: unknown,
    redirectCount: number,
  ): Promise<T> {
    const location = response.headers.get('location');
    if (!location) {
      throw new WooCommerceNetworkException(
        `WooCommerce redirect (HTTP ${response.status}) had no Location header: ${fromUrl}`,
      );
    }
    if (redirectCount >= MAX_REDIRECTS) {
      throw new WooCommerceNetworkException(
        `WooCommerce exceeded ${MAX_REDIRECTS} redirects starting from ${fromUrl}`,
      );
    }

    // Resolve relative redirects against the current URL.
    let target: URL;
    try {
      target = new URL(location, fromUrl);
    } catch {
      throw new WooCommerceNetworkException(
        `WooCommerce redirect Location is not a valid URL: ${location}`,
      );
    }

    if (target.protocol !== 'https:') {
      throw new WooCommerceNetworkException(
        `WooCommerce redirect to a non-https target is blocked (would leak credentials): ${target.toString()}`,
      );
    }
    if (!isUrlSsrfSafe(target.toString())) {
      throw new WooCommerceNetworkException(
        `WooCommerce redirect to a private or internal address is blocked: ${target.toString()}`,
      );
    }

    return this.request<T>(method, target.toString(), body, redirectCount + 1);
  }

  /**
   * Reads the WC REST error envelope `{ code, message, data }` and returns the
   * machine-readable `code`. Best-effort: a non-JSON or bodyless error response
   * yields `undefined` rather than throwing.
   */
  private async extractErrorCode(response: Response): Promise<string | undefined> {
    try {
      const parsed: unknown = await response.json();
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'code' in parsed &&
        typeof (parsed as { code: unknown }).code === 'string'
      ) {
        return (parsed as { code: string }).code;
      }
    } catch {
      // Non-JSON / empty body — no code to extract.
    }
    return undefined;
  }

  private buildAuthHeader(): string {
    return 'Basic ' + Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString('base64');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
