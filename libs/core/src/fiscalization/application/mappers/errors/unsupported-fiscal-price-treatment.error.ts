/**
 * Unsupported Fiscal Price Treatment Error
 *
 * Raised by the order -> command mapper when the order is net-priced.
 *
 * A fiscal registration transmits amounts it must not recompute (ADR-042
 * decision 8), and OpenLinker never computes or defaults a tax rate - so it
 * cannot convert net to gross. Passing net amounts through as gross would
 * silently mis-state the registered sale, which is why this fails loud instead
 * of degrading.
 *
 * This is a PERMANENT limitation of a net-line-price source (PrestaShop,
 * WooCommerce), not a gap #2829/#2832's `totalTaxTreatment` signal relaxes -
 * see `describeNetPricedOrderRefusal` (#2835) for why.
 *
 * @module libs/core/src/fiscalization/application/mappers/errors
 */
export class UnsupportedFiscalPriceTreatmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedFiscalPriceTreatmentError';
    Error.captureStackTrace(this, this.constructor);
  }
}
