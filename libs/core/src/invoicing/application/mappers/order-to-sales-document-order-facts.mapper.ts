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
 * - `totalGross` / `currency` / `taxTreatment` — read verbatim from
 *   `order.totals`. The evaluator itself is what turns an `exclusive`
 *   treatment into the terminal `net-priced-order` signal; this mapper never
 *   re-derives or converts anything.
 * - `buyerHasTaxId` — ALWAYS `undefined` (never defaulted to `false`): the
 *   `Order` contract carries no buyer-tax-id field yet (a separate, tracked
 *   prerequisite — see ADR-041 decision 5 / `SalesDocumentOrderFacts`'s own
 *   doc comment). "Unknown" and "known to have no tax id" are different
 *   facts, and defaulting to `false` would let a `buyerHasTaxId` rule
 *   condition silently misfire on exactly the orders this gap is honest about
 *   not knowing. No heuristic inference (company-name guessing, VAT-looking
 *   free-text strings) is performed, by design.
 *
 * @module libs/core/src/invoicing/application/mappers
 * @see docs/architecture/adrs/041-sales-document-routing-policy.md
 */
import type { Order } from '@openlinker/core/orders';
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
    taxTreatment: order.totals.taxTreatment,
    // Never defaulted — see the module doc comment.
    buyerHasTaxId: undefined,
  };
}
