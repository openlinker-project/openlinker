/**
 * Buyer-tax-id rule coverage (#2546, updated #2822)
 *
 * A `buyerHasTaxId` condition is evaluated against `Order.buyerTaxId` — real
 * since #2599, but only ever populated when the order's SOURCE actually
 * asserted the fact. None of the four sources report it unconditionally:
 * - **PrestaShop** reports it only when the buyer filled in a VAT number on
 *   the address (`ps_address.vat_number`) — that field is optional and
 *   blank on essentially every consumer order, so a B2C order still reads
 *   as unknown.
 * - **Allegro** and **Erli** report it only when the buyer requested a VAT
 *   invoice with company data at checkout (Allegro's
 *   `invoice.address.company`, Erli's `user.invoiceAddress.nip`) — a private
 *   (non-invoice) checkout carries neither, and the field stays unknown.
 * - **WooCommerce** reports it only when the store runs a VAT-number plugin
 *   that writes one of a short allowlisted set of `meta_data` keys (WC core
 *   has no native VAT field at all) — see
 *   `WOOCOMMERCE_VAT_META_KEY_ALLOWLIST` in
 *   `woocommerce-order-source.adapter.ts` for the exact list.
 *
 * This is deliberately NOT "this rule can never match" for any of the four
 * sources — it is conditional per source, and per order. Both counts are
 * reported so the operator can judge whether the gap matters for their own
 * connection mix, rather than being told a flat "N rules are dead" that
 * would be wrong the moment a qualifying order arrives.
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
