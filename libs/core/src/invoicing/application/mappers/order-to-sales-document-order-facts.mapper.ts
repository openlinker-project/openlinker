/**
 * Order -> SalesDocumentOrderFacts mapper (#2173, ADR-041 decision 5)
 *
 * Pure function (no NestJS, no I/O) that builds the reduced projection
 * `ISalesDocumentRulesService.resolveRouting` / `evaluateSalesDocumentRules`
 * consume, from the clean core `Order` `AutoIssueTriggerService` already has
 * in hand. Never reaches for `Order` fields the rule engine was not designed
 * to see (see `SalesDocumentOrderFacts`'s own doc comment).
 *
 * - `country` — the DELIVERY address's country (`order.shippingAddress.country`),
 *   per ADR-041 decision 5's own stated choice of which address decides
 *   jurisdiction (delivery, not billing) — not re-litigated here. Returns
 *   `null` when no delivery-address country can be determined at all, so the
 *   caller treats this exactly like "no rule-engine configuration for this
 *   order" and falls back to the pre-#2170 single-primary resolver rather than
 *   guessing a jurisdiction.
 * - `totalGross` / `currency` — read verbatim from `order.totals`.
 * - `taxTreatment` — `order.totals.totalTaxTreatment ?? order.totals.taxTreatment`
 *   (#2829). `totals.taxTreatment` is source-uniform and also governs the
 *   per-line/subtotal net-conversion path (`convertGrossToNet`, the ADR-063
 *   net-sales tax-rate resolution), so a source whose line prices are net but
 *   whose `total` is genuinely gross (PrestaShop, WooCommerce) cannot flip it
 *   without breaking those. `totalTaxTreatment` is the narrower, `total`-only
 *   signal such a source may set instead; every other source leaves it unset
 *   and falls back to `taxTreatment` unchanged. The evaluator itself is what
 *   turns an `exclusive` (or absent) result into the terminal
 *   `net-priced-order` signal; this mapper never re-derives or converts
 *   anything.
 * - `buyerHasTaxId` - read from the order's own buyer tax id (#2599), which
 *   closed the prerequisite ADR-041 decision 5 was waiting on. It stays
 *   `undefined` whenever the source asserted nothing, and is `false` only when
 *   a source positively said the buyer has none: "unknown" and "known to have
 *   no tax id" are different facts, and defaulting the first to `false` would
 *   let a `buyerHasTaxId` rule condition misfire on exactly the orders OL is
 *   honest about not knowing. Still no heuristic inference - no company-name
 *   guessing, no VAT-looking free-text scraping - and the value itself is not
 *   validated here.
 *
 * @module libs/core/src/invoicing/application/mappers
 * @see docs/architecture/adrs/041-sales-document-routing-policy.md
 */
// Value imports come from the `@openlinker/core/orders/types` cycle-breaker
// sub-barrel, never the main barrel: that one re-exports `OrdersModule`, whose
// own module file value-imports `@openlinker/core/invoicing`, so a value import
// here would close an `invoicing -> orders -> invoicing` CJS load cycle. `Order`
// is type-only and erases, so it may come from either.
import type { Order } from '@openlinker/core/orders';
import { buyerHasTaxId, readBuyerTaxId } from '@openlinker/core/orders/types';
import type { SalesDocumentOrderFacts } from '@openlinker/core/sales-documents';

/**
 * Build the rule-engine's order-facts projection from `order`, or `null` when
 * the order carries no delivery-address country to route on.
 */
export function toSalesDocumentOrderFacts(order: Order): SalesDocumentOrderFacts | null {
  const country = order.shippingAddress?.country;
  if (country === undefined || country.trim().length === 0) {
    return null;
  }

  return {
    country,
    totalGross: order.totals.total,
    currency: order.totals.currency,
    taxTreatment: order.totals.totalTaxTreatment ?? order.totals.taxTreatment,
    // Stays `undefined` when the source asserted nothing — see the module doc
    // comment. Never defaulted to `false`.
    buyerHasTaxId: buyerHasTaxId(readBuyerTaxId(order)),
  };
}
