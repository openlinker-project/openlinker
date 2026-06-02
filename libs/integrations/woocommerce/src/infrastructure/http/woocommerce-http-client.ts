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
 * @module libs/integrations/woocommerce/src/infrastructure/http
 */
import type { RetryConfig } from './woocommerce-http-client.types';
import type { IWooCommerceHttpClient } from './woocommerce-http-client.interface';
import { WooCommerceUnauthorizedException } from '../../domain/exceptions/woocommerce-unauthorized.exception';
import { WooCommerceNetworkException } from '../../domain/exceptions/woocommerce-network.exception';
import { WooCommerceHttpResponseException } from './woocommerce-http-response.exception';

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 500,
  backoffMultiplier: 2,
  maxDelayMs: 8000,
};

const REQUEST_TIMEOUT_MS = 30_000;

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

  private async request<T>(method: string, url: string, body?: unknown): Promise<T> {
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
        });

        if (response.ok) {
          return (await response.json()) as T;
        }

        // Never retry auth errors or not-found
        if (response.status === 401 || response.status === 403) {
          throw new WooCommerceUnauthorizedException(
            `WooCommerce authentication failed (HTTP ${response.status})`,
          );
        }

        if (response.status === 404) {
          throw new WooCommerceHttpResponseException(
            response.status,
            `WooCommerce returned HTTP ${response.status}: ${url}`,
          );
        }

        // Retryable: 429 and 5xx
        if (attempt < this.retryConfig.maxRetries) {
          await this.sleep(Math.min(delay, this.retryConfig.maxDelayMs));
          delay *= this.retryConfig.backoffMultiplier;
          continue;
        }

        // Retries exhausted — still a known HTTP error response
        throw new WooCommerceHttpResponseException(
          response.status,
          `WooCommerce returned HTTP ${response.status} after ${this.retryConfig.maxRetries} retries`,
        );
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

  private buildAuthHeader(): string {
    return 'Basic ' + Buffer.from(`${this.consumerKey}:${this.consumerSecret}`).toString('base64');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
