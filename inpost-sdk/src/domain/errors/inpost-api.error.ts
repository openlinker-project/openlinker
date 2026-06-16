/**
 * InPost API Error
 *
 * Normalizes a ShipX error response (`{ status, error, message, details }`)
 * into a typed exception the client throws on any HTTP >= 400. Keeps the
 * transport's status code and InPost error code (`token_invalid`,
 * `validation_failed`, …) inspectable by callers without re-parsing bodies.
 *
 * @module domain/errors
 */

export interface InpostApiErrorArgs {
  readonly message: string;
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;
  readonly method: string;
  readonly url: string;
}

export class InpostApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly details: unknown;
  readonly method: string;
  readonly url: string;

  constructor(args: InpostApiErrorArgs) {
    super(args.message);
    this.name = 'InpostApiError';
    this.status = args.status;
    this.code = args.code;
    this.details = args.details;
    this.method = args.method;
    this.url = args.url;
    Error.captureStackTrace?.(this, this.constructor);
  }

  static fromResponse(
    method: string,
    url: string,
    status: number,
    body: unknown,
  ): InpostApiError {
    const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const code = typeof record.error === 'string' ? record.error : undefined;
    const apiMessage = typeof record.message === 'string' ? record.message : `HTTP ${status}`;
    const message = `InPost ${method} ${url} → ${status}${code ? ` [${code}]` : ''}: ${apiMessage}`;
    return new InpostApiError({
      message,
      status,
      code,
      details: 'details' in record ? record.details : body,
      method,
      url,
    });
  }
}
