/**
 * ApiError
 *
 * Normalised error thrown by the node API client when a request fails or the
 * server returns a non-2xx status. Carries the status code and response body so
 * specs can assert on failures precisely.
 *
 * @module api
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly body: unknown,
  ) {
    super(`${method} ${path} failed with HTTP ${status}: ${JSON.stringify(body)}`);
    this.name = 'ApiError';
  }
}
