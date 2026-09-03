/**
 * Gross-price eligibility for document issuance (#2835)
 *
 * `invoicing` and `fiscalization` each compose a document whose lines are
 * GROSS by contract (`InvoiceLine.unitPriceGross`,
 * `FiscalTransactionLine.unitPriceGross`) directly from `OrderItem.price`, so
 * both refuse an order whose LINE prices are net
 * (`OrderTotals.taxTreatment === 'exclusive'`) rather than compose a document
 * that mislabels a net figure as gross. Converting a net line price to gross
 * would mean computing `net * (1 + rate)` — arithmetic that computes tax, which
 * ADR-063 § 5 forbids core from doing ("Core may group and divide amounts; it
 * may never compute tax"). So this is a genuine, structural refusal, not an
 * oversight: it holds even though the per-line tax rate is often already known
 * (`OrderItem.taxRate`, ADR-063), because knowing the rate does not make
 * *computing* an amount with it any less forbidden for a figure that feeds a
 * legal document.
 *
 * **#2829/#2832's `OrderTotals.totalTaxTreatment` does NOT relax this.** That
 * field describes `total` ALONE — PrestaShop's `total` genuinely is gross
 * while its line prices (`order_details.product_price`, #2440) stay net — and
 * both write paths compose `unitPriceGross` from the per-item price, never
 * from the order total. Reading `totalTaxTreatment` here would let a
 * PrestaShop order pass this guard and then silently mislabel its still-net
 * line prices as gross on the composed document: the exact corruption this
 * guard exists to prevent, just moved one level down. So the guard correctly
 * keeps reading `taxTreatment` (the LINE-level signal) and ignores
 * `totalTaxTreatment` entirely.
 *
 * This is a PERMANENT limitation of a net-line-price source (PrestaShop,
 * WooCommerce — both hardcode `taxTreatment: 'exclusive'`) under the current
 * architecture, not a gap waiting for this refusal to be relaxed. It clears
 * only if the source adapter itself starts reporting gross line prices (a
 * platform-specific mapper change, out of scope for `libs/core`) — never by
 * teaching core to convert.
 *
 * WHY HERE. Both document contexts need the identical answer and the
 * identical operator-facing wording, and a fiscal receipt is not an invoice,
 * so neither `invoicing` nor `fiscalization` could own it for the other — the
 * same reason `shipping-tax-split.types` and `tax-rate-enforcement.types` live
 * in this leaf. Import-free, like both of those.
 *
 * @module libs/core/src/sales-documents/domain/types
 * @see docs/architecture/adrs/063-per-line-tax-rate-resolution-and-provenance.md
 */

/** The narrow order shape this check needs — never the full `Order` entity. */
export interface GrossPriceEligibilityOrder {
  id: string;
  totals: {
    taxTreatment?: string;
  };
}

/**
 * `null` when the order's line prices are gross-eligible for document
 * issuance; otherwise an actionable, operator-facing sentence naming the
 * actual constraint — never the unqualified "only gross-priced orders are
 * supported", which gave an operator no way to tell whether their own order
 * or their own connection was the problem.
 *
 * `action` names what the caller was trying to do, in a form that reads
 * naturally both as "cannot be {action}" and as "can be {action} today" —
 * e.g. `'invoiced'`, `'fiscally registered'`.
 */
export function describeNetPricedOrderRefusal(
  order: GrossPriceEligibilityOrder,
  action: string
): string | null {
  if (order.totals.taxTreatment !== 'exclusive') {
    return null;
  }
  return (
    `Order ${order.id} cannot be ${action}: its source reports net (tax-exclusive) line prices, ` +
    `and OpenLinker never computes or infers tax to convert them to gross for a fiscal document — ` +
    `only a source that reports gross (tax-inclusive) line prices can be ${action} today.`
  );
}
