/**
 * Invoice Issue Contended Exception (#2047)
 *
 * Raised when the per-order issuance lock is held by a concurrent attempt AND no
 * blocking record is persisted yet for the order - i.e. a peer is between its own
 * guard read and its `pending` row, or mid-provider-call, with nothing to hand
 * back. Rather than proceed into the two-documents-for-one-sale race the lock
 * exists to prevent, this attempt declines.
 *
 * It is a **retryable** signal, and critically a "nothing was issued" signal:
 * this attempt never reached the `Invoicing` adapter, so it created no document
 * at the provider. Distinct from {@link OrderAlreadyInvoicedException}, which is
 * a persisted-state FACT that no retry can change (terminal); a contended
 * attempt is a timing accident that a retry resolves - by then the peer has
 * persisted its row, so the retry gets either the peer's record or a truthful
 * already-invoiced refusal.
 *
 * That split is why the worker's `invoicing.issue` handler must NOT fold this
 * into its `OrderAlreadyInvoicedException` -> terminal `business_failure` branch:
 * it falls through to the handler's default retryable wrap (ADR-007), which is
 * the correct outcome.
 *
 * Country-agnostic (ADR-026): the message names the order id only. Mapped to
 * HTTP 409 at the controller boundary, like the shipping context's
 * `ShipmentDispatchContendedException`.
 *
 * @module libs/core/src/invoicing/domain/exceptions
 */
export class InvoiceIssueContendedException extends Error {
  constructor(public readonly orderId: string) {
    super(
      `Issuance is already in progress for order ${orderId}; no document was created by ` +
        `this attempt - retry`,
    );
    this.name = 'InvoiceIssueContendedException';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, InvoiceIssueContendedException);
    }
  }
}
