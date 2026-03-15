export class ApiError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
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
}
