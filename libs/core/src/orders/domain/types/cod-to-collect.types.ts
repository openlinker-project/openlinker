/**
 * Cash-on-Delivery Collect Amount (#1435)
 *
 * Source-derived amount the buyer pays on delivery for a cash-on-delivery
 * order. Carried on the neutral order model (`IncomingOrder` / `Order` +
 * persisted snapshot) so the shipment-dispatch gate can prefer the
 * marketplace-sourced amount over an operator-typed value, and gate COD on the
 * order's payment status rather than trusting FE input.
 *
 * Its own one-shape-per-file type (engineering-standards §"Type Definitions in
 * Separate Files"), mirroring the shipping-context `ShipmentCod` shape — but
 * owned by the orders context so no cross-context dependency on shipping is
 * introduced (orders never depends on shipping).
 *
 * `amount` is a decimal **string** (not a number) so the value crosses the
 * adapter/persistence boundary without binary float rounding (`'510.94'`,
 * not `510.94`) — matching how source adapters (Allegro `summary.totalToPay`)
 * express money.
 *
 * @module libs/core/src/orders/domain/types
 */
import { minorUnitExponentFor } from '@openlinker/core/sales-documents';

export interface CodToCollect {
  /** Amount to collect on delivery, as a decimal string (e.g. `'510.94'`). */
  amount: string;
  /** ISO 4217 currency code (e.g. `'PLN'`). */
  currency: string;
}

/**
 * The amount a courier collects for a cash-on-delivery order whose source states
 * no explicit "amount to collect" (#3294), or `undefined` when there is no
 * honest figure to state.
 *
 * On a COD order nothing has been paid in advance, so the amount is the order's
 * gross total - the figure Shoper already reports this way and Allegro reports
 * as `summary.totalToPay`. Pure rule beside the
 * type it builds (the pure-rule exception in `docs/engineering-standards.md`),
 * so three adapters cannot spell "how much is collected" three ways.
 *
 * `undefined` rather than `'0.00'` for a zero or unusable total and for a blank
 * currency: an amount that is not known must read as absent so a label never
 * pre-fills a figure nobody asserted. Formatted to the currency's own minor-unit
 * exponent (`minorUnitExponentFor`, two decimals unless the currency is a known
 * exception), so a zero-decimal currency is not stated with a spurious fraction.
 */
export function toCodToCollect(total: number, currency: string): CodToCollect | undefined {
  if (!Number.isFinite(total) || total <= 0) {
    return undefined;
  }
  const trimmed = currency.trim();
  if (trimmed === '') {
    return undefined;
  }
  return { amount: total.toFixed(minorUnitExponentFor(trimmed)), currency: trimmed };
}
