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

  /**
   * Make POST request with a raw binary body.
   *
   * Used for endpoints that accept image / file bytes (`upload.allegro.pl/sale/images`)
   * — `Content-Type` comes from the parameter, not the JSON default. The body
   * is passed straight to fetch as `Uint8Array`; no JSON serialization happens.
   * Otherwise behaves identically to `post`: same auth header, same retry +
   * token-refresh machinery.
   *
   * @param path - API path (e.g., '/sale/images')
   * @param contentType - MIME type of the body (e.g., 'image/jpeg')
   * @param body - Raw bytes
   * @param options - Request options (headers, query params)
   * @returns Response data
   */
  postBinary<T = unknown>(
    path: string,
    contentType: string,
    body: Uint8Array,
    options?: Omit<AllegroHttpRequestOptions, 'method' | 'body'>,
  ): Promise<AllegroHttpResponse<T>>;

  /**
   * Make POST request with a multipart/form-data body.
   *
   * Used for endpoints that accept file uploads with metadata
   * (Allegro's safety-information attachment endpoint, etc.) where the
   * filename has to travel alongside the bytes via
   * `Content-Disposition`. A boundary is generated per request; each
   * part carries its own `Content-Type` header. Otherwise behaves
   * identically to `post` — same auth header, same retry +
   * token-refresh machinery.
   *
   * @param path - API path (e.g., '/sale/sale-product-offer-attachments')
   * @param parts - Ordered list of multipart parts to send
   * @param options - Request options (headers, query params)
   * @returns Response data
   */
  postMultipart<T = unknown>(
    path: string,
    parts: AllegroMultipartPart[],
    options?: Omit<AllegroHttpRequestOptions, 'method' | 'body'>,
  ): Promise<AllegroHttpResponse<T>>;
}

/**
 * One part of a multipart/form-data request.
 *
 * `name` is the field name in the form (`Content-Disposition: form-data;
 * name="..."`). `fileName`, when present, is added to the
 * `Content-Disposition` header so the receiving server can identify the
 * upload by its original filename. `contentType` becomes the part's
 * `Content-Type`. `bytes` is the raw payload — no encoding is applied.
 */
export interface AllegroMultipartPart {
  name: string;
  fileName?: string;
  contentType: string;
  bytes: Uint8Array;
}


