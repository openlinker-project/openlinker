/**
 * UnsupportedPriceTreatmentError
 *
 * Neutral mapping error thrown by the Order -> IssueInvoiceCommand composer when
 * the order's `totals.taxTreatment` is `exclusive` (net-priced): `InvoiceLine`
 * requires a GROSS unit price, and the MVP maps gross-priced orders only.
 * Rather than mislabel net as gross (silent totals corruption), the mapper fails
 * loud. Messages cite ONLY `order.id`. No country/document-type vocabulary.
 *
 * This is a PERMANENT limitation of a net-line-price source (PrestaShop,
 * WooCommerce), not a gap #2829/#2832's `totalTaxTreatment` signal relaxes —
 * see `describeNetPricedOrderRefusal` (#2835) for why.
 *
 * @module libs/core/src/invoicing/application/mappers/errors
 */
export class UnsupportedPriceTreatmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedPriceTreatmentError';
  }
}
