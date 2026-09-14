/**
 * InfaktApiError — thrown by InfaktHttpClient on non-2xx responses.
 *
 * `statusCode` is the HTTP status; `responseBody` is the raw parsed response
 * (or raw text when the response wasn't JSON).
 *
 * Carries the neutral `failureMode` discriminator core's `InvoiceService`
 * reads STRUCTURALLY (#1200) to decide fiscal re-attemptability — core never
 * value-imports this class:
 *   - `4xx` except `429` -> `'rejected'`: Infakt DEFINITELY did not create a
 *     document (deterministic rejection) — SAFE to re-attempt.
 *   - `429` or `5xx` -> `'in-doubt'`: rate-limited or a server-side failure;
 *     the document MAY already exist (or be mid-flight) — UNSAFE to
 *     auto-re-attempt. Mirrors `SubiektBridgeTransportError`'s retryability
 *     pivot.
 *
 * @module libs/integrations/infakt/src/domain/exceptions
 */
export class InfaktApiError extends Error {
  /**
   * Neutral failure discriminator the core `InvoiceService` reads
   * STRUCTURALLY (#1200) to decide re-attemptability.
   */
  readonly failureMode: 'rejected' | 'in-doubt';

  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly responseBody: unknown,
    /**
     * Operator-readable rejection reason, read STRUCTURALLY (duck-typed) by
     * core's `InvoiceService.classifyFailureCode` (#1200/W1) — mirrors
     * `SubiektInvoiceRejectedError.reason`. Optional and OL-authored: `message`
     * deliberately never echoes the raw provider response body (it can carry
     * buyer PII), so `reason` is the one place an adapter may recognise a
     * SPECIFIC rejection shape (e.g. a missing `errors.sale_type`, #3031) and
     * hand core a PII-free phrase it can match against a published marker
     * list to derive a more actionable `InvoiceFailureCode` than the generic
     * `provider-rejected`.
     */
    public readonly reason?: string,
  ) {
    super(message);
    this.name = 'InfaktApiError';
    this.failureMode = this.isClientError() && statusCode !== 429 ? 'rejected' : 'in-doubt';
    Error.captureStackTrace(this, this.constructor);
  }

  isClientError(): boolean {
    return this.statusCode >= 400 && this.statusCode < 500;
  }

  isServerError(): boolean {
    return this.statusCode >= 500;
  }
}
