/**
 * Buyer-tax-id rule coverage (#2546)
 *
 * A `buyerHasTaxId` condition is evaluated against `Order.buyerTaxId` — as of
 * #2599 that field is real, but it is populated only by sources that report
 * it. Today that is PrestaShop alone (`ps_address.vat_number`); Allegro's own
 * checkout-form invoice block carries a company tax id OL's
 * `AllegroCheckoutForm` type does not model, and WooCommerce's `billing`
 * block has no tax field at all (see `order-to-sales-document-order-facts.mapper.ts`
 * and `evaluateSalesDocumentRules`'s own doc comment).
 *
 * This is deliberately NOT "this rule can never match" — that claim was true
 * before #2599 and is false now. A `buyerHasTaxId` rule is fully live for a
 * PrestaShop-sourced order and simply unreachable for an order whose source
 * never asserts the fact. Both counts are reported so the operator can judge
 * whether the gap matters for their own connection mix, rather than being
 * told a flat "N rules are dead" that would be wrong the moment a PrestaShop
 * order arrives.
 *
 * @module apps/web/src/features/sales-documents/lib
 */
import type { SalesDocumentRule } from '../api/sales-document-rules.types';

export function usesBuyerTaxIdCondition(rule: SalesDocumentRule): boolean {
  return rule.conditions.some((condition) => condition.field === 'buyerHasTaxId');
}

export function countRulesUsingBuyerTaxId(rules: readonly SalesDocumentRule[]): number {
  return rules.filter(usesBuyerTaxIdCondition).length;
}

export function describeBuyerTaxIdRuleCount(count: number): string {
  return count === 1 ? "1 rule reads the buyer's tax ID" : `${count} rules read the buyer's tax ID`;
}
