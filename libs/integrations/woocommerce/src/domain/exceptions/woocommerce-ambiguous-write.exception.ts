/**
 * WooCommerce Ambiguous Write Exception
 *
 * Raised when a NON-idempotent write (`POST` without an `idempotent: true`
 * opt-in, #3469) fails with an ambiguous outcome — an ambiguous `5xx` or a
 * network/timeout error — that MAY have already committed server-side.
 * `WooCommerceHttpClient` refuses to auto-retry it internally (#3469), but
 * the failure still propagates out of the job that called it, and
 * `SyncJobRunner` retries any job-level failure by default unless a
 * registered `RetryClassifierPort` says otherwise. Before this,
 * `WooCommerceRetryClassifierAdapter` classified only
 * `WooCommerceOrderCreateAmbiguousException` (the narrower "2xx with no id"
 * case) — a plain `WooCommerceHttpResponseException` / `WooCommerceNetworkException`
 * read as an ordinary retryable transport failure, so a job-level retry
 * would re-run `createOrder` and re-POST the same order.
 *
 * Distinct from `WooCommerceOrderCreateAmbiguousException`: that one means
 * "WooCommerce answered 2xx but the body carried no id" (the create likely
 * DID succeed); this one means "the request itself failed ambiguously" (the
 * create MAY have succeeded). Both are non-retryable for the same reason.
 *
 * @module libs/integrations/woocommerce/src/domain/exceptions
 */
export class WooCommerceAmbiguousWriteException extends Error {
  constructor(
    message: string,
    public readonly method: string,
    /** The full request URL — this client only has the constructed URL in scope at the throw site, not a bare path. */
    public readonly url: string,
    public readonly statusCode?: number,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'WooCommerceAmbiguousWriteException';
    Error.captureStackTrace(this, this.constructor);
  }
}
