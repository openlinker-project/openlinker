/**
 * Shipment Insured-Value (Declared-Value / Insurance) Types
 *
 * Carrier-neutral declared-value / insurance descriptor for a label-generation
 * command. Lives in core/shipping so every shipping adapter that supports an
 * insured value (InPost ShipX #1542, future couriers) maps from one canonical
 * shape; the adapter translates it to its provider's wire format (e.g. ShipX's
 * `insurance` object with a numeric `amount` + `currency`).
 *
 * Like `ShipmentCod` / `ShipmentRecipient` / `ShipmentParcel`, this is its own
 * one-shape-per-file type (engineering-standards §"Type Definitions in Separate
 * Files"); it is referenced as the optional `GenerateLabelCommand.insuredValue`
 * field.
 *
 * **Caller-supplied, not order-sourced.** The insured value is part of the
 * label payload the dispatch caller owns (operator input), exactly like
 * `recipient` / `parcel` / `cod` — it is NOT derived from a persisted `Order`
 * in the dispatch seam.
 *
 * `amount` is a decimal **string** (not a number) so the value crosses the
 * adapter boundary without binary float rounding (`'150.00'`, not `150.0`),
 * mirroring `ShipmentCod.amount`.
 *
 * @module libs/core/src/shipping/domain/types
 */

export interface ShipmentInsuredValue {
  /** Declared value to insure, as a decimal string (e.g. `'150.00'`). */
  amount: string;
  /** ISO 4217 currency code (e.g. `'PLN'`). Adapter validates carrier support. */
  currency: string;
}
