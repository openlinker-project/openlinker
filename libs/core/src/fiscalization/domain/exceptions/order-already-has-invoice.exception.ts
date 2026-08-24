/**
 * Order Already Has Invoice Exception (#2157, ADR-041 §3a/3b)
 *
 * Raised when an order that already carries a BLOCKING `InvoiceRecord` (a
 * different SALES-DOCUMENT KIND — an invoice, not a fiscal receipt) is asked to
 * register a fiscal receipt. ADR-041 decision 3a is exclusive across document
 * KINDS: an order gets at most one *originating* sales document, invoice **or**
 * fiscal receipt, never both. This is the cross-kind sibling of
 * `OrderAlreadyRegisteredException` (ADR-042 decision 6), which guards the
 * SAME-kind case (another fiscal registration already exists) — that guard is
 * unchanged; this one closes the gap ADR-041 names.
 *
 * "Blocking" is `InvoiceRecord.blocksIssuanceElsewhere` — `pending`, `issuing`,
 * `issued`, or `failed` with any `failureMode` other than the terminal
 * `rejected`. Only a terminal `rejected` failure (the provider definitely
 * issued nothing) leaves the order free to be fiscally registered.
 *
 * Kept as a SIBLING exception (not a shared neutral one) for the same reason
 * documented on its invoicing-side counterpart,
 * `OrderAlreadyHasFiscalReceiptException`: the two report different record
 * shapes and wording, and the ADR-041-anticipated shared `sales-documents` home
 * for this pair is not yet more than a type-only leaf on this branch.
 *
 * Country- and vendor-agnostic (ADR-042 decision 4): the message names ids and
 * a neutral status only. Mapped to HTTP 409 at the controller boundary.
 *
 * @module libs/core/src/fiscalization/domain/exceptions
 */
import type { InvoiceStatus } from '@openlinker/core/invoicing';

export class OrderAlreadyHasInvoiceException extends Error {
  constructor(
    public readonly orderId: string,
    /** The invoicing connection that already holds the blocking record. */
    public readonly invoicingConnectionId: string,
    /** The fiscalization connection the refused request targeted. */
    public readonly requestedConnectionId: string,
    /** Neutral status of the blocking record. */
    public readonly blockingStatus: InvoiceStatus,
    /** The blocking record's id, so an operator can open it directly. */
    public readonly blockingInvoiceId: string,
  ) {
    super(
      `Order ${orderId} already has an invoice on connection ${invoicingConnectionId} ` +
        `(invoice ${blockingInvoiceId}, status ${blockingStatus}); it cannot also be fiscally ` +
        `registered on connection ${requestedConnectionId}`,
    );
    this.name = 'OrderAlreadyHasInvoiceException';
    Error.captureStackTrace(this, this.constructor);
  }
}
