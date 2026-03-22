export class ApiError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }

  isUnauthorized(): boolean {
    return this.status === 401;
  }

  isForbidden(): boolean {
    return this.status === 403;
  }

  isNotFound(): boolean {
    return this.status === 404;
  }

  isServerError(): boolean {
    return this.status >= 500;
  }

  isNetworkError(): boolean {
    return this.status === 0;
  }

  static fromResponse(response: Response, details: unknown): ApiError {
    if (typeof details === 'object' && details !== null && 'message' in details) {
      const message = Array.isArray(details.message) ? details.message.join(', ') : String(details.message);
      return new ApiError(message, response.status, details);
    }

    if (typeof details === 'string' && details.length > 0) {
      return new ApiError(details, response.status, details);
    }

    return new ApiError(response.statusText || 'Request failed', response.status, details);
  }

  static fromNetworkFailure(cause: unknown): ApiError {
    const message = cause instanceof Error ? cause.message : 'Network request failed';
    return new ApiError(message, 0, cause);
  }

  static fromTimeout(path: string): ApiError {
    return new ApiError(`Request timed out: ${path}`, 0, { timeout: true, path });
  }
}
