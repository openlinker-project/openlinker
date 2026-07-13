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

export interface CodToCollect {
  /** Amount to collect on delivery, as a decimal string (e.g. `'510.94'`). */
  amount: string;
  /** ISO 4217 currency code (e.g. `'PLN'`). */
  currency: string;
}
