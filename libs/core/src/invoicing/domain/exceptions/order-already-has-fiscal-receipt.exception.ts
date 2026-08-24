/**
 * Order Already Has Fiscal Receipt Exception (#2157, ADR-041 §3a/3b)
 *
 * Raised when an order that already carries a BLOCKING `FiscalRegistrationRecord`
 * (a different SALES-DOCUMENT KIND — a fiscal receipt, not an invoice) is asked
 * to issue an invoice. ADR-041 decision 3a is exclusive across document KINDS,
 * not just within one: an order gets at most one *originating* sales document,
 * invoice **or** fiscal receipt, never both. This is the cross-kind sibling of
 * `OrderAlreadyInvoicedException` (#2047), which guards the SAME-kind case
 * (another invoice already exists) — that guard is unchanged; this one closes
 * the gap ADR-041 names but #2047 never covered, because fiscalization did not
 * exist yet.
 *
 * "Blocking" is `FiscalRegistrationRecord.blocksFurtherRegistration` —
 * `pending`, `registering`, `registered`, or `failed` with any `failureMode`
 * other than the terminal `rejected`. Only a terminal `rejected` failure (the
 * provider definitely registered nothing) leaves the order free to be invoiced.
 *
 * Kept as a SIBLING exception rather than folded into `OrderAlreadyInvoicedException`:
 * the two report genuinely different blocking record shapes (`FiscalRegistrationRecord`
 * vs `InvoiceRecord`, distinct status vocabularies) and distinct wording ("has a
 * fiscal receipt" vs "is already invoiced") — collapsing them into one class with
 * an internal kind switch would make the message construction conditional for no
 * benefit, since callers already `instanceof`-branch per exception type. A shared
 * neutral home (a `sales-documents` bounded context) is the ADR-041-anticipated
 * destination for this pair once that context exists as more than a type-only
 * leaf (ADR-041 decision 1: "module now, context later") — not yet the case on
 * this branch, so this stays a context-owned sibling for now, mirroring
 * `OrderAlreadyRegisteredException` / this file's fiscalization counterpart
 * `OrderAlreadyHasInvoiceException`.
 *
 * Country-agnostic (ADR-026) and vendor-agnostic (ADR-042): the message names
 * ids and a neutral status only. Mapped to HTTP 409 at the controller boundary.
 *
 * @module libs/core/src/invoicing/domain/exceptions
 */
import type { FiscalRegistrationStatus } from '@openlinker/core/fiscalization';

export class OrderAlreadyHasFiscalReceiptException extends Error {
  constructor(
    public readonly orderId: string,
    /** The fiscalization connection that already holds the blocking record. */
    public readonly registeringConnectionId: string,
    /** The invoicing connection the rejected request targeted. */
    public readonly requestedConnectionId: string,
    /** Neutral status of the blocking record. */
    public readonly blockingStatus: FiscalRegistrationStatus,
    /** The blocking record's id, so an operator can open it directly. */
    public readonly blockingRecordId: string,
  ) {
    super(
      `Order ${orderId} already has a fiscal receipt on connection ${registeringConnectionId} ` +
        `(registration ${blockingRecordId}, status ${blockingStatus}); it cannot also be invoiced ` +
        `on connection ${requestedConnectionId}`,
    );
    this.name = 'OrderAlreadyHasFiscalReceiptException';
    Error.captureStackTrace(this, this.constructor);
  }
}
