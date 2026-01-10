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
    const normalizedBaseUrl: string = baseUrl.replace(/\/$/, '');
    this.baseUrl = normalizedBaseUrl;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const apiKeyValue: string = credentials.webserviceApiKey;
    this.apiKey = apiKeyValue;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const configTimeoutMs: number | undefined = config.timeoutMs;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const configPageSize: number | undefined = config.pageSize;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const configLangId: number | undefined = config.langId;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const configResponseFormat: 'auto' | 'json' | 'xml' | undefined = config.responseFormat;
    const timeoutMs: number = configTimeoutMs ?? 30000;
    const pageSize: number = configPageSize ?? 100;
    const langId: number = configLangId ?? 1;
    const responseFormat: 'auto' | 'json' | 'xml' = configResponseFormat ?? 'auto';
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const configShopId: number | undefined = config.shopId;
    this.config = {
      baseUrl: normalizedBaseUrl,
      timeoutMs,
      pageSize,
      langId,
      responseFormat,
      shopId: configShopId,
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

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const configResponseFormat = this.config.responseFormat;
    const responseFormat: 'auto' | 'json' | 'xml' = configResponseFormat ?? 'auto';
    const parsed = PrestashopResponseParser.parse(
      response.body,
      response.contentType,
      responseFormat,
    );

    // Unwrap single resource response
    // PrestaShop JSON API returns: { product: { ... } } for single resources
    // We need to unwrap it to return just the product object
    const parsedObj = parsed as Record<string, unknown>;
    const itemKey = resource.slice(0, -1); // e.g., 'product' (singular from 'products')

    // Check if parsed object has the resource key (e.g., 'product')
    if (parsedObj[itemKey] && typeof parsedObj[itemKey] === 'object') {
      // Unwrap: return the inner object (e.g., parsed.product)
      return parsedObj[itemKey] as T;
    }

    // If no unwrapping needed, return as-is
    return parsed as T;
  }

  async listResources<T = unknown>(
    resource: string,
    filters?: PrestashopQueryFilters,
    limit?: number,
    offset?: number,
  ): Promise<T[]> {
    const path = PrestashopQueryBuilder.buildResourcePath(resource);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const configPageSize = this.config.pageSize;
    const pageSize: number = configPageSize ?? 100;
    const query = PrestashopQueryBuilder.buildQueryWithPagination(
      resource,
      filters,
      this.config,
      limit ?? pageSize,
      offset,
    );
    const url = `${this.baseUrl}${path}?${query}`;

    this.logger.debug(`Listing resources: ${resource} (limit: ${limit ?? pageSize}, offset: ${offset ?? 0})`);

    const response = await this.requestWithRetry(url, {
      method: 'GET',
    });

    const configResponseFormat = this.config.responseFormat;
    const responseFormat: 'auto' | 'json' | 'xml' = configResponseFormat ?? 'auto';
    const parsed = PrestashopResponseParser.parse(
      response.body,
      response.contentType,
      responseFormat,
    );

    // PrestaShop returns collections in different formats
    // Normalize to array
    return this.normalizeCollection<T>(parsed, resource);
  }

  async createResource<T = unknown>(resource: string, data: Record<string, unknown>): Promise<T> {
    const path = PrestashopQueryBuilder.buildResourcePath(resource);
    const url = `${this.baseUrl}${path}`;

    this.logger.debug(`Creating resource: ${resource}`);

    // PrestaShop WebService API expects XML format for POST requests
    // We'll use JSON for simplicity (if PrestaShop supports it) or convert to XML
    const configResponseFormat = this.config.responseFormat;
    const responseFormat: 'auto' | 'json' | 'xml' = configResponseFormat ?? 'auto';
    const useJson = responseFormat === 'json' || (responseFormat === 'auto' && true); // PrestaShop 1.7+ supports JSON

    // Wrap data in PrestaShop format: { prestashop: { order: { ... } } }
    const resourceKey = resource.slice(0, -1); // e.g., 'order' from 'orders'
    const wrappedData = {
      prestashop: {
        [resourceKey]: data,
      },
    };

    const body = useJson ? JSON.stringify(wrappedData) : this.convertToXml(wrappedData);
    const contentType = useJson ? 'application/json' : 'application/xml';

    const response = await this.requestWithRetry(url, {
      method: 'POST',
      body,
      headers: {
        'Content-Type': contentType,
      },
    });

    const parsed = PrestashopResponseParser.parse(
      response.body,
      response.contentType,
      responseFormat,
    );

    // Unwrap single resource response
    // PrestaShop returns: { prestashop: { order: { id: ..., ... } } }
    const parsedObj = parsed as Record<string, unknown>;
    if (parsedObj.prestashop && typeof parsedObj.prestashop === 'object') {
      const prestashop = parsedObj.prestashop as Record<string, unknown>;
      if (prestashop[resourceKey] && typeof prestashop[resourceKey] === 'object') {
        return prestashop[resourceKey] as T;
      }
    }

    // Fallback: return as-is
    return parsed as T;
  }

  /**
   * Convert object to XML (simple implementation for MVP)
   * For full XML support, consider using a library like xml2js or fast-xml-parser
   */
  private convertToXml(data: unknown): string {
    // For MVP, we'll use JSON and let PrestaShop handle it
    // If PrestaShop requires XML, we'll need a proper XML builder
    // This is a placeholder - PrestaShop 1.7+ supports JSON
    return JSON.stringify(data);
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
      } catch (error: unknown) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
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
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
    const configTimeoutMs = this.config.timeoutMs;
    const timeoutMs: number = configTimeoutMs ?? 30000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

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
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        const configTimeoutMs = this.config.timeoutMs;
        const timeoutMs: number = configTimeoutMs ?? 30000;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
        const timeoutError = new PrestashopApiException(
          `Request timeout after ${timeoutMs}ms: ${url}`,
          undefined,
          undefined,
        );
        throw timeoutError;
      }
      if (
        error instanceof PrestashopApiException ||
        error instanceof PrestashopAuthenticationException ||
        error instanceof PrestashopResourceNotFoundException
      ) {
        throw error;
      }
      const errorMessage: string = error instanceof Error ? error.message : String(error);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
      const networkError = new PrestashopApiException(
        `Network error: ${errorMessage}`,
        undefined,
        undefined,
      );
      throw networkError;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Handle HTTP error responses
   */
  private handleError(statusCode: number, body: string, url: string): never {
    if (statusCode === 401) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
      const authError = new PrestashopAuthenticationException(
        `Authentication failed: Invalid API key for ${url}`,
        undefined,
        this.baseUrl,
      );
      throw authError;
    }

    if (statusCode === 404) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
      const notFoundError = new PrestashopResourceNotFoundException(
        `Resource not found: ${url}`,
        undefined,
        undefined,
      );
      throw notFoundError;
    }

    if (statusCode >= 500) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
      const serverError = new PrestashopApiException(
        `PrestaShop API server error (${statusCode}): ${url}`,
        statusCode,
        body.substring(0, 500),
      );
      throw serverError;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
    const apiError = new PrestashopApiException(
      `PrestaShop API error (${statusCode}): ${url}`,
      statusCode,
      body.substring(0, 500),
    );
    throw apiError;
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

