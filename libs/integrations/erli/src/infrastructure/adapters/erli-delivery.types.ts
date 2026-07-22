/**
 * Erli Delivery Dictionary Wire Shapes (#1738)
 *
 * Wire types + path constants for the two read-only delivery endpoints backing
 * `ErliOrderSourceAdapter`'s `SourceOptionsReader.listDeliveryMethods`:
 *
 *  - `GET /dictionaries/deliveryMethods` — the FULL platform dictionary
 *    (~114 entries `{ id, name, cod, vendor }`); ids are the same tokens Erli
 *    stamps on orders as `delivery.typeId` (e.g. `erliPaczkomat`, `dpdCod`).
 *  - `GET /delivery/priceListsDetails` — the seller's active price lists; each
 *    `prices[].deliveryMethod.id` names a method the shop actually offers, so
 *    the intersection with the dictionary is the set of methods an order can
 *    arrive with.
 *
 * Both shapes verified against the live sandbox (`sandbox.erli.dev`) on
 * 2026-07-20. Note: the sibling `GET /delivery/priceLists` (id+name only) is
 * consumed by `ErliOfferManagerAdapter.listDeliveryPriceLists` (#1530) via
 * `ErliDeliveryPriceListItem` in `erli-product.types.ts` — a different, offer-
 * creation-scoped concern; this file owns only the routing-options shapes.
 *
 * @module libs/integrations/erli/src/infrastructure/adapters
 */

/** `GET /dictionaries/deliveryMethods` — full platform delivery-method dictionary. */
export const ERLI_DELIVERY_METHODS_DICT_PATH = 'dictionaries/deliveryMethods';

/** `GET /delivery/priceListsDetails` — the seller's active price lists with per-method prices. */
export const ERLI_PRICE_LISTS_DETAILS_PATH = 'delivery/priceListsDetails';

/** One entry of the platform delivery-method dictionary. */
export interface ErliDeliveryMethodDictEntry {
  /** Stable method token — identical to `ErliOrderDelivery.typeId` on orders. */
  id: string;
  /** Operator-facing display name (repeats across weight tiers of one method family). */
  name: string;
  /** Whether the method is a cash-on-delivery variant. */
  cod?: boolean;
  /** Carrier vendor token (`inpost`, `dpd`, `dhl`, …). */
  vendor?: string;
}

/** One per-method price row inside a price list. Only the method id is consumed. */
export interface ErliPriceListPriceEntry {
  deliveryMethod?: {
    id?: string;
  };
}

/** One seller price list with its per-method price rows. */
export interface ErliPriceListDetails {
  id: number;
  name?: string;
  prices?: ErliPriceListPriceEntry[];
}
