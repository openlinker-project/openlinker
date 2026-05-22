/**
 * Shipment Recipient Types
 *
 * Carrier-neutral recipient + structured postal address for a label-
 * generation command. Lives in core/shipping so every shipping adapter
 * (InPost #764, Allegro Delivery #732, …) maps from one canonical shape; the
 * adapter translates to its provider's wire format (e.g. ShipX `receiver` /
 * `address` Peer).
 *
 * `address` is optional at the type level: locker/paczkomat shipments are
 * addressed by the locker id (`GenerateLabelCommand.paczkomatId`), so ShipX
 * omits the receiver address for them. Adapters that require an address for a
 * given method (courier) validate its presence and throw a domain exception
 * when it's missing — the type stays permissive, the adapter enforces.
 *
 * Distinct from `PickupPointAddress` (display-oriented `line1`/`line2`): a
 * shipping address needs `street` + `buildingNumber` split out because that's
 * what carrier create-shipment APIs require.
 *
 * @module libs/core/src/shipping/domain/types
 */

export interface ShipmentAddress {
  street: string;
  buildingNumber: string;
  city: string;
  postCode: string;
  /** ISO 3166-1 alpha-2 (e.g. `'PL'`). */
  countryCode: string;
}

export interface ShipmentRecipient {
  /** Company or full name; used by the provider when first/last are absent. */
  name?: string;
  firstName?: string;
  lastName?: string;
  /** Required — carriers use it for pickup / delivery notifications. */
  email: string;
  /** Required — carriers use it for the SMS pickup code / delivery contact. */
  phone: string;
  /**
   * Optional for locker shipments (addressed by locker id); adapters require
   * it for courier shipments.
   */
  address?: ShipmentAddress;
}
