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
 * **#3365: the adapters now report them, and this is the escape hatch this
 * module always named.** The paragraph that stood here called the refusal a
 * PERMANENT limitation of a net-line-price source, and said in the same breath
 * that it "clears only if the source adapter itself starts reporting gross line
 * prices (a platform-specific mapper change, out of scope for `libs/core`)".
 * That is exactly what happened, and the premise underneath the word
 * "permanent" turned out to be factually wrong for both sources:
 *
 * - PrestaShop stores `order_detail.unit_price_tax_incl` and returns it on the
 *   same webservice read OpenLinker already makes; the mapper simply discarded
 *   it. Verified live: `product_price = 1499.000000` beside
 *   `unit_price_tax_incl = 1843.770000` on one row, the latter matching that
 *   order's own `total_paid_tax_incl`.
 * - WooCommerce reports `total` and `total_tax` per line; their sum is what the
 *   buyer paid.
 *
 * So the rule is UNCHANGED and the guard is merely narrowed: core still never
 * converts, and `net * (1 + rate)` appears nowhere. What it now distinguishes
 * is "this source prices net" (not by itself a reason to refuse) from "this
 * source prices net AND told us nothing gross" (still a refusal, and still
 * for the original reason).
 *
 * Two properties keep the narrowing honest. EVERY line must carry a gross
 * price - a document mixing real gross lines with net ones relabelled gross is
 * the precise corruption this guard exists to prevent, just partial. And gross
 * SHIPPING is required too when the order charges any, because a shipping line
 * composed from the net figure mislabels it exactly as a product line would.
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

/**
 * The narrow order shape this check needs — never the full `Order` entity.
 *
 * `taxTreatment` is deliberately `string`, not the domain `PriceTaxTreatment`
 * union (`@openlinker/core/orders/types`): importing it would add a fourth
 * type-only exception to this leaf's zero-outbound-core-edge barrel-purity
 * allowlist for a one-field narrowing that buys nothing today — every real
 * caller passes an `Order` whose field is already `PriceTaxTreatment`, and
 * structural typing keeps them honest. The guard below fails open on any
 * unrecognised value (returns `null`, i.e. "eligible"), which is latent, not
 * live, for exactly that reason. Do not "tighten" this to close the latent
 * gap without first re-reading the leaf-purity tradeoff above.
 */
export interface GrossPriceEligibilityOrder {
  id: string;
  totals: {
    taxTreatment?: string;
    /** Shipping as `taxTreatment` describes it - net on a net-priced source. */
    shipping?: number;
    /** Gross shipping when the source reported one (#3365). */
    shippingGross?: number;
  };
  /**
   * The order's lines, needed only to ask whether every one of them carries a
   * source-reported gross price. Deliberately the narrowest shape that answers
   * that - no id, no quantity, no rate - so this leaf keeps depending on
   * nothing (see the note above about `taxTreatment` being a bare `string`).
   */
  items?: ReadonlyArray<{ unitPriceGross?: number }>;
}

/**
 * What the caller was trying to do. Closed rather than a bare `string`, so a
 * new value is a compile-time signal that a new caller showed up rather than
 * silent wording drift.
 *
 * The first two are this leaf's own document contexts. The third (#3365) is a
 * DESTINATION order mirror - an ERP's order document, which is not a fiscal
 * document but carries the same gross-amount field and therefore breaks in the
 * same way on a net figure. It is deliberately neutral: naming a platform here
 * is what ADR-026 keeps out of `libs/core`. It exists so the rule lives in ONE
 * place; before it, a destination adapter carried its own copy of the same
 * `taxTreatment === 'exclusive'` test, which would have stayed narrow-minded
 * while this one was widened.
 */
export const NetPricedOrderRefusalActionValues = [
  'invoiced',
  'fiscally registered',
  'recorded in the destination system',
] as const;
export type NetPricedOrderRefusalAction = (typeof NetPricedOrderRefusalActionValues)[number];

/**
 * `null` when the order's line prices are gross-eligible for document
 * issuance; otherwise an actionable, operator-facing sentence naming the
 * actual constraint — never the unqualified "only gross-priced orders are
 * supported", which gave an operator no way to tell whether their own order
 * or their own connection was the problem.
 *
 * `action` names what the caller was trying to do, in a form that reads
 * naturally both as "cannot be {action}" and as "can be {action}". The
 * message still does not say "today", and for the same reason as before: what
 * it names is a fact about the SOURCE, not a missing OpenLinker feature. It no
 * longer calls that fact permanent (see the module docblock) - since #3365 a
 * source reporting gross figures clears it, which is what both shipped sources
 * now do.
 */
export function describeNetPricedOrderRefusal(
  order: GrossPriceEligibilityOrder,
  action: NetPricedOrderRefusalAction
): string | null {
  if (order.totals.taxTreatment !== 'exclusive') {
    return null;
  }

  const items = order.items ?? [];
  // An order with no lines cannot be rescued by a per-line gross price, so the
  // original refusal stands. It is also not this guard's job to complain about
  // emptiness - the document composers have their own say on that.
  const everyLineHasGross =
    items.length > 0 && items.every((item) => isUsableAmount(item.unitPriceGross));
  const shippingCharged = isUsableAmount(order.totals.shipping) && order.totals.shipping > 0;
  const shippingCovered = !shippingCharged || isUsableAmount(order.totals.shippingGross);

  if (everyLineHasGross && shippingCovered) {
    return null;
  }

  // The sentence names WHICH half is missing, because the two have different
  // remedies: a source that reports no gross at all is a platform fact an
  // operator cannot act on, while a gap on shipping alone points at one field.
  const missing = !everyLineHasGross
    ? `and its source reported no gross (tax-inclusive) price for ${
        items.length === 0 ? 'this order' : 'every line'
      }`
    : `and its source reported no gross (tax-inclusive) shipping amount, although the order charges shipping`;

  // The sentence keeps BOTH readings the action union is shaped for - "cannot
  // be {action}" opening it and "can be {action}" closing it - so the value
  // still reads naturally in either direction.
  return (
    `Order ${order.id} cannot be ${action}: its source reports net (tax-exclusive) line prices, ` +
    `${missing}. OpenLinker never computes or infers tax to convert a net amount to gross for a ` +
    `fiscal document — only an order carrying a gross (tax-inclusive) figure its own source ` +
    `reported can be ${action}.`
  );
}

/** A money figure this guard is willing to rely on: present, numeric, finite. */
function isUsableAmount(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
