/**
 * InvalidInvoiceLineError
 *
 * Neutral mapping error thrown by the Order -> IssueInvoiceCommand composer when
 * an order item cannot form a valid invoice line - today: a quantity that is not
 * a positive finite number (#1525). A zero/negative quantity typically comes from
 * a malformed order snapshot (the rehydrator defaults it to 0); passing it through
 * would divide unit-price derivations (KSeF's P_9A) to NaN downstream. The mapper
 * fails loud instead. Messages cite ONLY `order.id`. No country/document-type
 * vocabulary.
 *
 * @module libs/core/src/invoicing/application/mappers/errors
 */
export class InvalidInvoiceLineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInvoiceLineError';
  }
}
