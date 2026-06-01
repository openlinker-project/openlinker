/**
 * WooCommerce HTTP Client
 *
 * Native-`fetch` transport for the WooCommerce REST API v3. Attaches Basic
 * Auth credentials (consumer key + consumer secret, Base64-encoded) on every
 * request and enforces a request timeout via `AbortController`.
 *
 * At scaffold stage (#873) the client performs a single attempt with no retry
 * loop — this is intentional. The retry loop and typed domain exceptions
 * (`WooCommerceUnauthorizedException`, `WooCommerceNetworkException`, etc.)
 * will be added in #874 when the first capability adapter lands, at which
 * point the `RetryConfig` constructor parameter will drive the loop without
 * a signature change.
 *
 * @module libs/integrations/woocommerce/src/infrastructure/http
 */
import type { RetryConfig } from './woocommerce-http-client.types';

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Thrown for non-2xx HTTP responses. Defined here as an implementation-private
 * error class (not a type alias or interface) — scoped to this file until
 * typed domain exceptions (WooCommerceUnauthorizedException, etc.) replace
 * it in #874. The tester catches generically and checks `statusCode`.
 */
class WooCommerceRequestError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'WooCommerceRequestError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class WooCommerceHttpClient {
  private readonly siteUrl: string;

  constructor(
    siteUrl: string,
    private readonly consumerKey: string,
    private readonly consumerSecret: string,
    // _retryConfig is accepted now so the constructor signature stays stable for #874,
    // when the retry loop and typed domain exceptions land. At scaffold stage
    // get() performs a single attempt only and this param is intentionally unused.
    _retryConfig?: Partial<RetryConfig>,
  ) {
    // Strip trailing slashes so path construction is always safe.
    // "https://myshop.com/" and "https://myshop.com" produce identical URLs.
    this.siteUrl = siteUrl.replace(/\/+$/, '');
  }

  async get<T>(path: string): Promise<T> {
    const url = `${this.siteUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: this.buildAuthHeader(),
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new WooCommerceRequestError(
          response.status,
          `WooCommerce returned HTTP ${response.status}`,
        );
      }

      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildAuthHeader(): string {
    // Buffer (Node.js server-side) — not btoa() which is browser-only in older runtimes.
    return 'Basic ' + Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString('base64');
  }
}
