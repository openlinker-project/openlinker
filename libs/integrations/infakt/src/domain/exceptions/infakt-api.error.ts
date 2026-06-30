/**
 * InfaktApiError — thrown by InfaktHttpClient on non-2xx responses.
 *
 * `statusCode` is the HTTP status; `responseBody` is the raw parsed response
 * (or raw text when the response wasn't JSON). The adapter translates these into
 * neutral domain exceptions or lets `in-doubt` transport errors propagate.
 *
 * @module libs/integrations/infakt/src/domain/exceptions
 */
export class InfaktApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly responseBody: unknown,
  ) {
    super(message);
    this.name = 'InfaktApiError';
    Error.captureStackTrace(this, this.constructor);
  }

  isClientError(): boolean {
    return this.statusCode >= 400 && this.statusCode < 500;
  }

  isServerError(): boolean {
    return this.statusCode >= 500;
  }
}
