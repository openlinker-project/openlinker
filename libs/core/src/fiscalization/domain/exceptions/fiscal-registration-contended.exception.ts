/**
 * Fiscal Registration Contended Exception (#2157)
 *
 * Raised when the per-order registration lock (shared with `InvoiceService`'s
 * per-order issuance lock, #2047) is held by a concurrent attempt AND no
 * blocking record is persisted yet for the order — a peer is between its own
 * guard read and its `pending` row, or mid-provider-call, with nothing to hand
 * back. Rather than proceed into the two-documents-for-one-sale race the lock
 * exists to prevent, this attempt declines.
 *
 * Mirrors `InvoiceIssueContendedException` exactly: a **retryable** "nothing was
 * registered by this attempt" signal, distinct from a persisted-state FACT
 * (`OrderAlreadyRegisteredException` / `OrderAlreadyHasInvoiceException`) that no
 * retry can change. A contended attempt is a timing accident a retry resolves —
 * by then the peer has persisted its row.
 *
 * Country- and vendor-agnostic (ADR-042 decision 4): the message names the order
 * id only. Mapped to HTTP 409 at the controller boundary.
 *
 * @module libs/core/src/fiscalization/domain/exceptions
 */
export class FiscalRegistrationContendedException extends Error {
  constructor(public readonly orderId: string) {
    super(
      `Fiscal registration is already in progress for order ${orderId}; no registration was ` +
        `created by this attempt - retry`,
    );
    this.name = 'FiscalRegistrationContendedException';
    Error.captureStackTrace(this, this.constructor);
  }
}
