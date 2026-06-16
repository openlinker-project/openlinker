/**
 * HTTP Client Port
 *
 * The single outbound transport seam of the SDK. The ShipX client depends only
 * on this interface — never on `fetch`, axios, or any concrete transport — so
 * callers can inject retries, rate-limiting, request logging, or a test double
 * without touching the client. The default `FetchHttpClientAdapter` implements
 * it over the global `fetch`.
 *
 * @module domain/ports
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** How the adapter should interpret a successful response body. */
export type HttpResponseType = 'json' | 'binary' | 'text';

export interface HttpRequest {
  readonly method: HttpMethod;
  /** Absolute URL — the client resolves base URL + path + query before calling. */
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  /** A plain JS value; the adapter is responsible for JSON serialization. */
  readonly body?: unknown;
  /** Defaults to `'json'`. `'binary'` yields a `Uint8Array` body (e.g. PDF labels). */
  readonly responseType?: HttpResponseType;
}

export interface HttpResponse<T = unknown> {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  /** Parsed JSON, raw text, or `Uint8Array` depending on `request.responseType`. */
  readonly body: T;
}

export interface HttpClientPort {
  send<T = unknown>(request: HttpRequest): Promise<HttpResponse<T>>;
}
