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
import type {
  IPrestashopWebserviceClient,
  PrestashopQueryFilters,
  PrestashopWriteOptions,
} from './prestashop-webservice.client.interface';
import type {
  PrestashopConnectionConfig,
  PrestashopCredentials,
} from '@openlinker/integrations-prestashop';
import {
  PrestashopAuthenticationException,
  PrestashopResourceNotFoundException,
  PrestashopApiException,
} from '@openlinker/integrations-prestashop';
import { PrestashopQueryBuilder } from './prestashop-query.builder';
import { PrestashopResponseParser } from './prestashop-response.parser';
import { Logger, formatBodyForLog } from '@openlinker/shared/logging';
import { XMLBuilder } from 'fast-xml-parser';

/**
 * Resources whose PrestaShop singular element name is not the plural minus a
 * trailing 's' (the naive `slice(0,-1)`). The WS XML envelope and the response
 * key both use the singular, so these must be mapped explicitly — e.g.
 * `order_histories → order_history`, not `order_historie`.
 */
const IRREGULAR_RESOURCE_SINGULARS: Readonly<Record<string, string>> = {
  addresses: 'address',
  order_histories: 'order_history',
};

/**
 * PrestaShop singular element name for a WS resource (handles irregular plurals).
 * WRITES ONLY — used to BUILD the request envelope (`{ prestashop: { <singular>: data } }`)
 * and to unwrap write responses. Reads (`getResource`) don't use this: they strip the
 * envelope by single-key shape, which is robust to every irregular singular without a map.
 */
function singularizeResource(resource: string): string {
  return IRREGULAR_RESOURCE_SINGULARS[resource] ?? resource.slice(0, -1);
}

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
  private readonly xmlBuilder: XMLBuilder;

  constructor(
    baseUrl: string,
    credentials: PrestashopCredentials,
    config: PrestashopConnectionConfig,
    retryConfig?: Partial<RetryConfig>
  ) {
    // Normalize baseUrl (remove trailing slash)
    const normalizedBaseUrl: string = baseUrl.replace(/\/$/, '');
    this.baseUrl = normalizedBaseUrl;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- prestashop webservice response is dynamically shaped; narrowed by the surrounding mapper / parser
    const apiKeyValue: string = credentials.webserviceApiKey;
    this.apiKey = apiKeyValue;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- prestashop webservice response is dynamically shaped; narrowed by the surrounding mapper / parser
    const configTimeoutMs: number | undefined = config.timeoutMs;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- prestashop webservice response is dynamically shaped; narrowed by the surrounding mapper / parser
    const configPageSize: number | undefined = config.pageSize;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- prestashop webservice response is dynamically shaped; narrowed by the surrounding mapper / parser
    const configLangId: number | undefined = config.langId;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- prestashop webservice response is dynamically shaped; narrowed by the surrounding mapper / parser
    const configResponseFormat: 'auto' | 'json' | 'xml' | undefined = config.responseFormat;
    const timeoutMs: number = configTimeoutMs ?? 30000;
    const pageSize: number = configPageSize ?? 100;
    const langId: number = configLangId ?? 1;
    const responseFormat: 'auto' | 'json' | 'xml' = configResponseFormat ?? 'auto';
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- prestashop webservice response is dynamically shaped; narrowed by the surrounding mapper / parser
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
    // Initialize XML builder for converting objects to XML (required for POST requests)
    this.xmlBuilder = new XMLBuilder({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      format: true,
      indentBy: '  ',
    });
  }

  async getResource<T = unknown>(resource: string, id: string | number): Promise<T> {
    const path = PrestashopQueryBuilder.buildResourcePath(resource, id);
    const url = `${this.baseUrl}${path}`;

    this.logger.debug(`Fetching resource: ${resource}/${id}`);

    const response = await this.requestWithRetry(url, {
      method: 'GET',
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- prestashop webservice response is dynamically shaped; narrowed by the surrounding mapper / parser
    const configResponseFormat = this.config.responseFormat;
    const responseFormat: 'auto' | 'json' | 'xml' = configResponseFormat ?? 'auto';
    const parsed = PrestashopResponseParser.parse(
      response.body,
      response.contentType,
      responseFormat
    );

    // Unwrap single resource response.
    // After the parser strips the `prestashop` wrapper, a single resource is
    // `{ <singular>: { ... } }` — e.g. `{ product: {...} }`, `{ address: {...} }`,
    // `{ country: {...} }`. The singular element name is NOT reliably the plural
    // minus a trailing 's': irregular -es plurals (`addresses` → `address`,
    // `countries` → `country`) and compound plurals (`order_histories` →
    // `order_history`) all break `slice(0, -1)`, which would leave the envelope
    // un-unwrapped and return `{ address: {...} }` instead of the inner object.
    // Robust rule: when the parsed object has exactly one top-level key whose
    // value is an object, that key is the resource wrapper — unwrap it. This is
    // language-agnostic and covers every singular form. Already-flat responses
    // (and multi-key shapes) fall through to "return as-is".
    const parsedObj = parsed as Record<string, unknown>;
    const topLevelKeys = Object.keys(parsedObj);
    if (topLevelKeys.length === 1) {
      const onlyKey = topLevelKeys[0];
      const inner = parsedObj[onlyKey];
      if (inner !== null && typeof inner === 'object') {
        return inner as T;
      }
    }

    // If no unwrapping needed, return as-is
    return parsed as T;
  }

  async listResources<T = unknown>(
    resource: string,
    filters?: PrestashopQueryFilters,
    limit?: number,
    offset?: number
  ): Promise<T[]> {
    const path = PrestashopQueryBuilder.buildResourcePath(resource);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- prestashop webservice response is dynamically shaped; narrowed by the surrounding mapper / parser
    const configPageSize = this.config.pageSize;
    const pageSize: number = configPageSize ?? 100;
    const query = PrestashopQueryBuilder.buildQueryWithPagination(
      resource,
      filters,
      this.config,
      limit ?? pageSize,
      offset
    );
    const url = `${this.baseUrl}${path}?${query}`;

    this.logger.debug(
      `Listing resources: ${resource} (limit: ${limit ?? pageSize}, offset: ${offset ?? 0})`
    );

    const response = await this.requestWithRetry(url, {
      method: 'GET',
    });

    const configResponseFormat = this.config.responseFormat;
    const responseFormat: 'auto' | 'json' | 'xml' = configResponseFormat ?? 'auto';
    const parsed = PrestashopResponseParser.parse(
      response.body,
      response.contentType,
      responseFormat
    );

    // PrestaShop returns collections in different formats
    // Normalize to array
    return this.normalizeCollection<T>(parsed, resource);
  }

  async createResource<T = unknown>(
    resource: string,
    data: Record<string, unknown>,
    options?: PrestashopWriteOptions
  ): Promise<T> {
    return this.writeResource<T>(resource, undefined, data, options);
  }

  async updateResource<T = unknown>(
    resource: string,
    id: string | number,
    data: Record<string, unknown>,
    options?: PrestashopWriteOptions
  ): Promise<T> {
    return this.writeResource<T>(resource, id, data, options);
  }

  async deleteResource(resource: string, id: string | number): Promise<void> {
    const path = PrestashopQueryBuilder.buildResourcePath(resource, id);
    const url = `${this.baseUrl}${path}`;
    this.logger.debug(`Deleting resource: ${resource}/${id}`);
    await this.requestWithRetry(url, { method: 'DELETE' });
  }

  async uploadImage(
    resourcePath: string,
    imageBytes: Uint8Array,
    mimeType: string,
    filename = 'image',
  ): Promise<{ id: string }> {
    const url = `${this.baseUrl}/api/${resourcePath}`;
    this.logger.debug(`Uploading image to ${resourcePath}`);

    const form = new FormData();
    form.append('image', new Blob([imageBytes], { type: mimeType }), filename);

    const headers = new Headers({
      Authorization: `Basic ${this.getBasicAuth()}`,
      'Output-Format': 'JSON',
    });

    // Own AbortController — intentionally not using requestWithRetry because
    // retrying a multipart POST creates duplicate image records on PS (#1164).
    const controller = new AbortController();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- prestashop webservice response is dynamically shaped; narrowed by the surrounding mapper / parser
    const configTimeoutMs = this.config.timeoutMs;
    const timeoutMs: number = configTimeoutMs ?? 30000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: form,
        signal: controller.signal,
      });

      const body = await response.text();

      if (!response.ok) {
        this.handleError(response.status, body, url);
      }

      const contentType = response.headers.get('content-type') ?? undefined;
      const parsed = PrestashopResponseParser.parse(body, contentType, 'auto');
      const obj = parsed as Record<string, unknown>;

      // PS image upload response: { prestashop: { image: { id } } } or { image: { id } }
      const inner =
        (obj.prestashop as Record<string, unknown> | undefined)?.image ?? obj.image;
      const imageData = inner as Record<string, unknown> | undefined;
      const rawId = imageData?.id ?? imageData?.['@_id'];

      if (rawId == null) {
        throw new PrestashopApiException(
          `Unexpected image upload response from ${url}: ${JSON.stringify(obj)}`,
          undefined,
          undefined,
        );
      }

      return { id: String(rawId) };
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new PrestashopApiException(
          `Image upload timeout after ${timeoutMs}ms: ${url}`,
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
      const errorMessage: string = error instanceof Error ? error.message : String(error);
      throw new PrestashopApiException(
        `Network error during image upload: ${errorMessage}`,
        undefined,
        undefined,
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Shared POST/PUT writer.
   *
   * PrestaShop's WebService accepts both POST (create) and PUT (update) with
   * the same XML envelope (`{ prestashop: { <singular>: data } }`) and returns
   * the same response shape. The only difference is the URL: PUT targets a
   * specific id. Keeping a single writer means the response-unwrap logic
   * doesn't drift between create and update paths.
   */
  private async writeResource<T = unknown>(
    resource: string,
    id: string | number | undefined,
    data: Record<string, unknown>,
    options?: PrestashopWriteOptions
  ): Promise<T> {
    const path = PrestashopQueryBuilder.buildResourcePath(resource, id);
    const requestUrl = `${this.baseUrl}${path}`;
    // `sendmail=1` is a PrestaShop WS *query* flag (not a body field) that
    // fires the order-state customer email on an `order_histories` write (#858).
    const url = options?.sendEmail
      ? `${requestUrl}${requestUrl.includes('?') ? '&' : '?'}sendmail=1`
      : requestUrl;

    const isUpdate = id !== undefined;
    this.logger.debug(
      `${isUpdate ? 'Updating' : 'Creating'} resource: ${resource}${isUpdate ? `/${id}` : ''}`
    );

    const configResponseFormat = this.config.responseFormat;
    const responseFormat: 'auto' | 'json' | 'xml' = configResponseFormat ?? 'auto';

    // Wrap data in PrestaShop format: { prestashop: { customer: { ... } } }
    // Singular element name (handles irregular plurals like addresses/order_histories).
    const resourceKey = singularizeResource(resource);
    const wrappedData = {
      prestashop: {
        [resourceKey]: data,
      },
    };

    // Always use XML for write requests (PrestaShop requirement for both POST and PUT)
    const body = this.convertToXml(wrappedData);
    const contentType = 'application/xml';

    const response = await this.requestWithRetry(url, {
      method: isUpdate ? 'PUT' : 'POST',
      body,
      headers: {
        'Content-Type': contentType,
      },
    });

    const parsed = PrestashopResponseParser.parse(
      response.body,
      response.contentType,
      responseFormat
    );

    // Unwrap single resource response
    // PrestaShop returns responses in different formats:
    // 1. With prestashop wrapper: { prestashop: { customer: { id: ..., ... } } }
    // 2. Without wrapper (direct): { customer: { id: ..., ... } }
    // In XML format, IDs are often attributes: { customer: { '@_id': '123', ... } }
    // Note: Some resources have irregular singular forms (e.g., 'addresses' → 'address', not 'addresse')
    const parsedObj = parsed as Record<string, unknown>;

    // `resourceKey` is already the irregular-aware singular (see singularizeResource).
    const singularResourceKey = resourceKey;

    // Try with prestashop wrapper first
    if (parsedObj.prestashop && typeof parsedObj.prestashop === 'object') {
      const prestashop = parsedObj.prestashop as Record<string, unknown>;
      // Try singular form first (correct for most resources)
      if (prestashop[singularResourceKey] && typeof prestashop[singularResourceKey] === 'object') {
        return this.normalizeWriteResponseId(
          prestashop[singularResourceKey] as Record<string, unknown>
        ) as T;
      }
      // Fallback: try original resourceKey (for edge cases)
      if (prestashop[resourceKey] && typeof prestashop[resourceKey] === 'object') {
        return this.normalizeWriteResponseId(
          prestashop[resourceKey] as Record<string, unknown>
        ) as T;
      }
    }

    // Try without prestashop wrapper (direct resource key)
    if (parsedObj[singularResourceKey] && typeof parsedObj[singularResourceKey] === 'object') {
      return this.normalizeWriteResponseId(
        parsedObj[singularResourceKey] as Record<string, unknown>
      ) as T;
    }

    // Fallback: try original resourceKey
    if (parsedObj[resourceKey] && typeof parsedObj[resourceKey] === 'object') {
      return this.normalizeWriteResponseId(parsedObj[resourceKey] as Record<string, unknown>) as T;
    }

    // Final fallback: return as-is and log warning
    this.logger.warn(
      `Could not extract resource from PrestaShop response. Resource: ${resource}, ResourceKey: ${resourceKey}, SingularKey: ${singularResourceKey}. Response structure: ${JSON.stringify(Object.keys(parsedObj))}`
    );
    return parsed as T;
  }

  /**
   * Normalize the `id` field of a written-back resource: PrestaShop's XML
   * envelope returns the id either as an `@_id` attribute or as a child
   * `<id>` tag. Either way callers expect `resource.id` as a string.
   */
  private normalizeWriteResponseId(resource: Record<string, unknown>): Record<string, unknown> {
    if (resource['@_id'] !== undefined && resource.id === undefined) {
      resource.id = resource['@_id'];
    }
    if (resource.id !== undefined) {
      resource.id = String(resource.id);
    }
    return resource;
  }

  /**
   * Convert object to XML using fast-xml-parser
   *
   * Converts JavaScript objects to PrestaShop-compatible XML format.
   * Handles nested objects, arrays, and primitive values.
   */
  private convertToXml(data: unknown): string {
    try {
      // XMLBuilder.build() returns a string, but TypeScript types it as any
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- prestashop webservice response is dynamically shaped; narrowed by the surrounding mapper / parser
      const xml = this.xmlBuilder.build(data) as string;
      // Ensure XML declaration is present
      if (!xml.startsWith('<?xml')) {
        return `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
      }
      return xml;
    } catch (error) {
      this.logger.error(
        `Failed to convert data to XML: ${error instanceof Error ? error.message : String(error)}`
      );
      throw new PrestashopApiException(
        `Failed to convert request data to XML format: ${error instanceof Error ? error.message : String(error)}`,
        undefined,
        undefined
      );
    }
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
    options: RequestInit
  ): Promise<{ body: string; contentType?: string }> {
    let lastError: Error | null = null;
    let delay = this.retryConfig.initialDelayMs;

    for (let attempt = 0; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        return await this.request(url, options);
      } catch (error: unknown) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- prestashop webservice response is dynamically shaped; narrowed by the surrounding mapper / parser
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
          if (
            statusCode !== undefined &&
            statusCode >= 400 &&
            statusCode < 500 &&
            statusCode !== 429
          ) {
            throw error; // Don't retry client errors (except 429)
          }
        }

        // Retry on server errors (5xx) or network errors
        if (attempt < this.retryConfig.maxRetries) {
          this.logger.error(lastError.message);
          this.logger.error(lastError.stack);
          this.logger.warn(
            `Request failed (attempt ${attempt + 1}/${this.retryConfig.maxRetries + 1}), retrying in ${delay}ms: ${lastError.message}`
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
  private async request(
    url: string,
    options: RequestInit
  ): Promise<{ body: string; contentType?: string }> {
    const startTime = Date.now();

    // Build headers
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Basic ${this.getBasicAuth()}`);
    // Set Output-Format based on request method:
    // - GET requests: prefer JSON (faster parsing)
    // - POST requests: use XML (required by PrestaShop for creating resources)
    const isPostRequest = options.method === 'POST';
    headers.set('Output-Format', isPostRequest ? 'XML' : 'JSON');

    // Log full request details
    this.logger.debug(`=== HTTP Request ===`);
    this.logger.debug(`Method: ${options.method || 'GET'}`);
    this.logger.debug(`URL: ${url}`);
    this.logger.debug(`Headers: ${JSON.stringify(Object.fromEntries(headers.entries()), null, 2)}`);
    if (options.body) {
      // Log full body for POST requests to help debug order creation issues
      if (options.method === 'POST' && typeof options.body === 'string') {
        this.logger.debug(`Body (full): ${options.body}`);
      } else {
        this.logger.debug(
          `Body: ${typeof options.body === 'string' ? formatBodyForLog(options.body) : '[binary]'}`
        );
      }
    }

    // Create AbortController for timeout
    const controller = new AbortController();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- prestashop webservice response is dynamically shaped; narrowed by the surrounding mapper / parser
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
      const contentType = response.headers.get('content-type') || undefined;
      const body = await response.text();

      // Log full response details
      this.logger.debug(`=== HTTP Response ===`);
      this.logger.debug(`Status: ${response.status} ${response.statusText}`);
      this.logger.debug(`Duration: ${duration}ms`);
      this.logger.debug(`Content-Type: ${contentType || 'unknown'}`);
      // Log response body (show full for errors to help debug)
      if (response.status >= 400) {
        this.logger.debug(`Response body (full for error): ${body || '(empty)'}`);
      } else {
        this.logger.debug(`Response body: ${formatBodyForLog(body)}`);
      }

      // Handle errors
      if (!response.ok) {
        this.handleError(response.status, body, url);
      }

      return { body, contentType };
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- prestashop webservice response is dynamically shaped; narrowed by the surrounding mapper / parser
        const configTimeoutMs = this.config.timeoutMs;
        const timeoutMs: number = configTimeoutMs ?? 30000;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- prestashop webservice response is dynamically shaped; narrowed by the surrounding mapper / parser
        const timeoutError = new PrestashopApiException(
          `Request timeout after ${timeoutMs}ms: ${url}`,
          undefined,
          undefined
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
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- prestashop webservice response is dynamically shaped; narrowed by the surrounding mapper / parser
      const networkError = new PrestashopApiException(
        `Network error: ${errorMessage}`,
        undefined,
        undefined
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
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- prestashop webservice response is dynamically shaped; narrowed by the surrounding mapper / parser
      const authError = new PrestashopAuthenticationException(
        `Authentication failed: Invalid API key for ${url}`,
        undefined,
        this.baseUrl
      );
      throw authError;
    }

    if (statusCode === 404) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- prestashop webservice response is dynamically shaped; narrowed by the surrounding mapper / parser
      const notFoundError = new PrestashopResourceNotFoundException(
        `Resource not found: ${url}`,
        undefined,
        undefined
      );
      throw notFoundError;
    }

    if (statusCode >= 500) {
      // Log line uses `formatBodyForLog` so operators can opt into a cap via
      // `OL_LOG_BODY_MAX_BYTES`; the exception carries the FULL body so any
      // downstream consumer can inspect or parse it (matches Allegro #409).
      this.logger.error(
        `PrestaShop API server error (${statusCode}): ${url}. Response body: ${formatBodyForLog(body)}`
      );
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- prestashop webservice response is dynamically shaped; narrowed by the surrounding mapper / parser
      const serverError = new PrestashopApiException(
        `PrestaShop API server error (${statusCode}): ${url}`,
        statusCode,
        body
      );
      throw serverError;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call -- prestashop webservice response is dynamically shaped; narrowed by the surrounding mapper / parser
    const apiError = new PrestashopApiException(
      `PrestaShop API error (${statusCode}): ${url}`,
      statusCode,
      body
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
