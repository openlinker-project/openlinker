/**
 * Subiekt Net-Priced Order Exception
 *
 * Raised when an order whose source reports NET (tax-exclusive) line prices,
 * AND reports no gross figure of its own, is routed to Subiekt. The ZK is
 * created with `LiczonyOdCenBrutto = true` and the per-line amounts are written
 * to `WartoscBruttoPrzedRabatem`/`PoRabacie`, so a
 * net figure written there is read by Subiekt as a gross one and the order is
 * booked roughly one VAT rate below what the buyer actually paid — silently,
 * with every total internally consistent.
 *
 * It REFUSES rather than converting. OpenLinker never computes or infers tax to
 * turn net into gross for a fiscal document (ADR-026); a ZK is the document the
 * invoice is later derived from, so letting it through would simply move the
 * same error one document downstream.
 *
 * **The rule itself is no longer restated here (#3365).** The adapter asks
 * core's `describeNetPricedOrderRefusal` and raises this with the answer, so
 * this exception now carries a message core composed rather than a second copy
 * of the same test. That matters because the rule was narrowed: a net-priced
 * source that reports its own gross amounts (PrestaShop's
 * `unit_price_tax_incl`, WooCommerce's `total + total_tax`) is no longer
 * refused, and a private copy of the old test here would have kept refusing it
 * with no error anywhere to say why.
 *
 * Terminal by classification (`SubiektRetryClassifierAdapter`): the source's
 * tax treatment is a property of the order, so every retry re-reads the same
 * value and reaches the same refusal.
 *
 * @module libs/integrations/subiekt/src/domain/exceptions
 */
export class SubiektNetPricedOrderException extends Error {
  /**
   * @param orderRef  operator-facing order reference, for the prefix.
   * @param reason    core's own sentence (`describeNetPricedOrderRefusal`).
   *                  Optional so an existing caller keeps its wording; the
   *                  adapter always supplies it.
   */
  constructor(orderRef: string, reason?: string) {
    super(
      reason ??
        `Order ${orderRef} reports net (tax-exclusive) line prices, which cannot be written to a Subiekt ZK: ` +
          `the document is gross-priced (LiczonyOdCenBrutto) and OpenLinker does not compute tax to convert them. ` +
          `Only a source reporting gross (tax-inclusive) prices can be sent to Subiekt.`,
    );
    this.name = 'SubiektNetPricedOrderException';
    Error.captureStackTrace(this, this.constructor);
  }
}
