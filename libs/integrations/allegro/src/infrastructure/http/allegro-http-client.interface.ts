/**
 * Allegro HTTP Client Interface
 *
 * Defines the contract for Allegro HTTP client operations. Provides methods
 * for making authenticated requests to Allegro Public API with retry logic,
 * rate limiting, and error handling.
 *
 * @module libs/integrations/allegro/src/infrastructure/http
 */

/**
 * HTTP request options
 */
export interface AllegroHttpRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: string | Record<string, unknown>;
  queryParams?: Record<string, string | number | boolean>;
}

/**
 * HTTP response
 */
export interface AllegroHttpResponse<T = unknown> {
  data: T;
  status: number;
  headers: Record<string, string>;
}

/**
 * Allegro HTTP Client Interface
 *
 * Interface for making HTTP requests to Allegro Public API.
 */
export interface IAllegroHttpClient {
  /**
   * Make GET request
   *
   * @param path - API path (e.g., '/order/events')
   * @param options - Request options (query params, headers)
   * @returns Response data
   */
  get<T = unknown>(path: string, options?: Omit<AllegroHttpRequestOptions, 'method' | 'body'>): Promise<AllegroHttpResponse<T>>;

  /**
   * Make POST request
   *
   * @param path - API path
   * @param body - Request body
   * @param options - Request options (headers, query params)
   * @returns Response data
   */
  post<T = unknown>(
    path: string,
    body?: Record<string, unknown> | string,
    options?: Omit<AllegroHttpRequestOptions, 'method' | 'body'>,
  ): Promise<AllegroHttpResponse<T>>;

  /**
   * Make PUT request
   *
   * @param path - API path
   * @param body - Request body
   * @param options - Request options (headers, query params)
   * @returns Response data
   */
  put<T = unknown>(
    path: string,
    body?: Record<string, unknown> | string,
    options?: Omit<AllegroHttpRequestOptions, 'method' | 'body'>,
  ): Promise<AllegroHttpResponse<T>>;

  /**
   * Make PATCH request
   *
   * @param path - API path
   * @param body - Request body (partial update)
   * @param options - Request options (headers, query params)
   * @returns Response data
   */
  patch<T = unknown>(
    path: string,
    body?: Record<string, unknown> | string,
    options?: Omit<AllegroHttpRequestOptions, 'method' | 'body'>,
  ): Promise<AllegroHttpResponse<T>>;
}


