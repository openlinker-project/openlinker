/**
 * Delivery Price List Types (#1530)
 *
 * Marketplace-neutral shape for a seller-configured delivery price list ("cennik
 * dostawy") the operator attaches to an offer so buyers can purchase it. Read
 * live per-connection from the marketplace via the `DeliveryPriceListReader`
 * capability and rendered in the offer-creation wizard.
 *
 * Neutral by construction: `id` is a stable opaque identifier and `name` is the
 * human label. A destination adapter owns any neutral -> wire mapping (Erli, for
 * example, references a price list by its unique `name` on product create).
 *
 * @module libs/core/src/listings/domain/types
 */

export interface DeliveryPriceList {
  /** Stable opaque identifier of the price list (platform-native id, stringified). */
  id: string;
  /** Human-readable, unique price-list name shown in the wizard picker. */
  name: string;
}
