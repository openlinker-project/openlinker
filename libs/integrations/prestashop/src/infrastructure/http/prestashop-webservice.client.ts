/**
 * PrestaShop WebService Client
 *
 * HTTP client implementation for PrestaShop WebService API. Uses native fetch
 * (Node 18+) for framework-agnostic HTTP requests. Handles authentication,
 * request building, response parsing, retries, and error handling.
 *
 * @module libs/integrations/prestashop/src/infrastructure/http
 * @implements {IPrestashopWebserviceClient}
 */
import { IPrestashopWebserviceClient, PrestashopQueryFilters } from './prestashop-webservice.client.interface';
import {
  PrestashopConnectionConfig,
  PrestashopCredentials,
  PrestashopAuthenticationException,
  PrestashopResourceNotFoundException,
  PrestashopApiException,
} from '@openlinker/integrations-prestashop';
import { PrestashopQueryBuilder } from './prestashop-query.builder';
import { PrestashopResponseParser } from './prestashop-response.parser';
import { Logger } from '@openlinker/shared/logging';

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
  maxDelayMs: 10000,
  backoffMultiplier: 2,
};

/**
 * PrestaShop WebService Client
 *
 * Implements HTTP client for PrestaShop WebService API using native fetch.
 */
export class PrestashopWebserviceClient implements IPrestashopWebserviceClient {
  private readonly logger = new Logger(PrestashopWebserviceClient.name);
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly config: PrestashopConnectionConfig;
  private readonly retryConfig: RetryConfig;

  constructor(
    baseUrl: string,
    credentials: PrestashopCredentials,
    config: PrestashopConnectionConfig,
    retryConfig?: Partial<RetryConfig>,
  ) {
    // Normalize baseUrl (remove trailing slash)
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = credentials.webserviceApiKey;
    this.config = {
      ...config,
      baseUrl: this.baseUrl, // Override with normalized baseUrl
      timeoutMs: config.timeoutMs ?? 30000,
      pageSize: config.pageSize ?? 100,
      langId: config.langId ?? 1,
      responseFormat: config.responseFormat ?? 'auto',
    };
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
  }

  async getResource<T = unknown>(resource: string, id: string | number): Promise<T> {
    const path = PrestashopQueryBuilder.buildResourcePath(resource, id);
    const url = `${this.baseUrl}${path}`;

    this.logger.debug(`Fetching resource: ${resource}/${id}`);

    const response = await this.requestWithRetry(url, {
      method: 'GET',
    });

    const parsed = PrestashopResponseParser.parse(
      response.body,
      response.contentType,
      this.config.responseFormat ?? 'auto',
    ) as T;

    return parsed;
  }

  async listResources<T = unknown>(
    resource: string,
    filters?: PrestashopQueryFilters,
    limit?: number,
    offset?: number,
  ): Promise<T[]> {
    const path = PrestashopQueryBuilder.buildResourcePath(resource);
    const query = PrestashopQueryBuilder.buildQueryWithPagination(
      resource,
      filters,
      this.config,
      limit ?? (this.config.pageSize ?? 100),
      offset,
    );
    const url = `${this.baseUrl}${path}?${query}`;

    this.logger.debug(`Listing resources: ${resource} (limit: ${limit ?? (this.config.pageSize ?? 100)}, offset: ${offset ?? 0})`);

    const response = await this.requestWithRetry(url, {
      method: 'GET',
    });

    const parsed = PrestashopResponseParser.parse(
      response.body,
      response.contentType,
      this.config.responseFormat ?? 'auto',
    );

    // PrestaShop returns collections in different formats
    // Normalize to array
    return this.normalizeCollection<T>(parsed, resource);
  }

  /**
   * Make HTTP request with retry logic
   *
   * @param url - Request URL
   * @param options - Fetch options
   * @returns Response with body and content type
   */
  private async requestWithRetry(
    url: string,
    options: RequestInit,
  ): Promise<{ body: string; contentType?: string }> {
    let lastError: Error | null = null;
    let delay = this.retryConfig.initialDelayMs;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        return await this.request(url, options);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on client errors (4xx) except 429 (rate limit)
        if (error instanceof PrestashopAuthenticationException) {
          throw error; // Don't retry auth errors
        }
        if (error instanceof PrestashopResourceNotFoundException) {
          throw error; // Don't retry not found errors
        }
        if (error instanceof PrestashopApiException) {
          const statusCode = error.statusCode;
          if (statusCode !== undefined && statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
            throw error; // Don't retry client errors (except 429)
          }
        }

        // Retry on server errors (5xx) or network errors
        if (attempt < this.retryConfig.maxRetries) {
          this.logger.error(lastError.message);
          this.logger.error(lastError.stack);
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
   * Make HTTP request
   *
   * @param url - Request URL
   * @param options - Fetch options
   * @returns Response with body and content type
   */
  private async request(url: string, options: RequestInit): Promise<{ body: string; contentType?: string }> {
    const startTime = Date.now();

    // Build headers
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Basic ${this.getBasicAuth()}`);
    headers.set('Output-Format', 'JSON'); // Prefer JSON

    // Create AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 30000);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      const duration = Date.now() - startTime;
      this.logger.debug(`Request completed: ${response.status} (${duration}ms)`);

      const contentType = response.headers.get('content-type') || undefined;
      const body = await response.text();

      // Handle errors
      if (!response.ok) {
        this.handleError(response.status, body, url);
      }

      return { body, contentType };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new PrestashopApiException(
          `Request timeout after ${this.config.timeoutMs ?? 30000}ms: ${url}`,
          undefined,
          undefined,
        );
      }
      if (
        error instanceof PrestashopApiException ||
        error instanceof PrestashopAuthenticationException ||
        error instanceof PrestashopResourceNotFoundException
      ) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new PrestashopApiException(
        `Network error: ${errorMessage}`,
        undefined,
        undefined,
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Handle HTTP error responses
   */
  private handleError(statusCode: number, body: string, url: string): never {
    if (statusCode === 401) {
      throw new PrestashopAuthenticationException(
        `Authentication failed: Invalid API key for ${url}`,
        undefined,
        this.baseUrl,
      );
    }

    if (statusCode === 404) {
      throw new PrestashopResourceNotFoundException(
        `Resource not found: ${url}`,
        undefined,
        undefined,
      );
    }

    if (statusCode >= 500) {
      throw new PrestashopApiException(
        `PrestaShop API server error (${statusCode}): ${url}`,
        statusCode,
        body.substring(0, 500),
      );
    }

    throw new PrestashopApiException(
      `PrestaShop API error (${statusCode}): ${url}`,
      statusCode,
      body.substring(0, 500),
    );
  }

  /**
   * Get Basic Auth header value
   *
   * PrestaShop uses Basic Auth with format: base64(apiKey:)
   */
  private getBasicAuth(): string {
    const credentials = `${this.apiKey}:`;
    return Buffer.from(credentials).toString('base64');
  }

  /**
   * Normalize collection response to array
   *
   * PrestaShop returns collections in various formats depending on count.
   * This normalizes to always return an array.
   */
  private normalizeCollection<T>(parsed: unknown, resource: string): T[] {
    if (Array.isArray(parsed)) {
      return parsed as T[];
    }

    if (parsed && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;

      // PrestaShop format: { prestashop: { products: { product: [...] } } }
      if (obj.prestashop && typeof obj.prestashop === 'object') {
        const prestashop = obj.prestashop as Record<string, unknown>;
        const resourceKey = resource; // e.g., 'products'
        const itemKey = resource.slice(0, -1); // e.g., 'product' (singular)

        if (prestashop[resourceKey] && typeof prestashop[resourceKey] === 'object') {
          const resourceData = prestashop[resourceKey] as Record<string, unknown>;
          if (resourceData[itemKey]) {
            const items = resourceData[itemKey];
            if (Array.isArray(items)) {
              return items as T[];
            }
            // Single item returned as object
            return [items] as T[];
          }
        }
      }

      // Unwrapped format (after parser normalization): { products: { product: [...] } }
      // The parser unwraps the 'prestashop' wrapper, so we need to handle unwrapped structure
      const resourceKey = resource; // e.g., 'products'
      const itemKey = resource.slice(0, -1); // e.g., 'product' (singular)

      if (obj[resourceKey] && typeof obj[resourceKey] === 'object') {
        const resourceData = obj[resourceKey] as Record<string, unknown>;
        if (resourceData[itemKey]) {
          const items = resourceData[itemKey];
          if (Array.isArray(items)) {
            return items as T[];
          }
          // Single item returned as object
          return [items] as T[];
        }
        // If resourceData is already an array (edge case)
        if (Array.isArray(resourceData)) {
          return resourceData as T[];
        }
      }

      // Try direct access (fallback)
      if (obj[resource] && Array.isArray(obj[resource])) {
        return obj[resource] as T[];
      }
    }

    // Fallback: return empty array
    this.logger.warn(`Unable to normalize collection for resource: ${resource}`);
    return [];
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

