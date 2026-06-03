/**
 * Shipment COD (Cash-on-Delivery) Types
 *
 * Carrier-neutral cash-on-delivery descriptor for a label-generation command.
 * Lives in core/shipping so every shipping adapter that supports COD (DPD
 * Polska #962, future couriers) maps from one canonical shape; the adapter
 * translates to its provider's wire format (e.g. DPD's COD `TransportService`
 * with `AMOUNT` / `CURRENCY` attributes).
 *
 * Like `ShipmentRecipient` / `ShipmentParcel`, this is its own one-shape-per-
 * file type (engineering-standards §"Type Definitions in Separate Files"); it
 * is referenced as the optional `GenerateLabelCommand.cod` field.
 *
 * **Caller-supplied, not order-sourced.** COD is part of the label payload the
 * dispatch caller owns (operator input / #966), exactly like `recipient` /
 * `parcel` — it is NOT derived from a persisted `Order` in the dispatch seam.
 *
 * `amount` is a decimal **string** (not a number) so the value crosses the
 * adapter boundary without binary float rounding (`'39.99'`, not `39.99`).
 *
 * @module libs/core/src/shipping/domain/types
 */

export interface ShipmentCod {
  /** COD amount to collect, as a decimal string (e.g. `'39.99'`). */
  amount: string;
  /** ISO 4217 currency code (e.g. `'PLN'`). Adapter validates carrier support. */
  currency: string;
}
