/**
 * Order Already Invoiced Exception (#2047)
 *
 * Raised when an order that already carries a BLOCKING `InvoiceRecord` on one
 * invoicing connection is asked to issue a second document on a DIFFERENT
 * connection. One sale is one invoice: KSeF / inFakt / Subiekt are alternative
 * routes for the same document to reach the authority, not complementary steps.
 *
 * "Blocking" is `InvoiceRecord.blocksIssuanceElsewhere` — `pending`, `issuing`,
 * `issued`, or `failed` with any `failureMode` other than `rejected`. Only a
 * terminal `rejected` failure (the provider definitely created nothing) leaves
 * another connection free to issue.
 *
 * Country-agnostic (ADR-026): the message names ids and a neutral status only.
 * Mapped to HTTP 409 at the controller boundary.
 *
 * @module libs/core/src/invoicing/domain/exceptions
 */
import type { InvoiceStatus } from '../types/invoicing.types';

export class OrderAlreadyInvoicedException extends Error {
  constructor(
    public readonly orderId: string,
    /** The connection that already holds the blocking record. */
    public readonly issuingConnectionId: string,
    /** The connection the rejected request targeted. */
    public readonly requestedConnectionId: string,
    /** Neutral status of the blocking record. */
    public readonly blockingStatus: InvoiceStatus,
    /** The blocking record's id, so an operator can open it directly. */
    public readonly blockingInvoiceId: string,
  ) {
    super(
      `Order ${orderId} is already invoiced on connection ${issuingConnectionId} ` +
        `(invoice ${blockingInvoiceId}, status ${blockingStatus}); ` +
        `it cannot also be invoiced on connection ${requestedConnectionId}`,
    );
    this.name = 'OrderAlreadyInvoicedException';
    Error.captureStackTrace(this, this.constructor);
  }
}
