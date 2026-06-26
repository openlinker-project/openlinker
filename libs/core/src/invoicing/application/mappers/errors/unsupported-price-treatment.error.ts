/**
 * UnsupportedPriceTreatmentError
 *
 * Neutral mapping error thrown by the Order -> IssueInvoiceCommand composer when
 * the order's `totals.taxTreatment` is `exclusive` (net-priced): `InvoiceLine`
 * requires a GROSS unit price, and the MVP maps gross-priced orders only.
 * Rather than mislabel net as gross (silent totals corruption), the mapper fails
 * loud. Messages cite ONLY `order.id`. No country/document-type vocabulary.
 *
 * @module libs/core/src/invoicing/application/mappers/errors
 */
export class UnsupportedPriceTreatmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedPriceTreatmentError';
  }
}
