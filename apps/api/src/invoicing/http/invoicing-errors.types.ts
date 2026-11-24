/**
 * Invoicing error types (#3864)
 *
 * @module apps/api/src/invoicing/http
 */

/** Why a document file cannot be served. Listed in `INVOICE_DOCUMENT_UNAVAILABLE`'s docs. */
export type InvoiceDocumentUnavailableReason =
  | 'no-snapshot'
  | 'no-source'
  | 'not-ready'
  | 'no-downloads'
  | 'kind-unsupported'
  | 'not-cleared'
  | 'no-confirmation'
  | 'too-large';

/** Why the document data is refused. Listed in `INVOICE_DATA_INVALID`'s docs. */
export type InvoiceDataInvalidReason =
  | 'buyer-profile'
  | 'invoice-line'
  | 'price-treatment'
  | 'unknown-order-lines';
