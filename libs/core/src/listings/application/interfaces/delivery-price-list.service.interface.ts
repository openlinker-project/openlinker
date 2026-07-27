/**
 * Delivery Price List Service Interface (#1530)
 *
 * Contract for the core read service that returns a connection's seller-configured
 * delivery price lists ("cennik dostawy"). Implemented by
 * `DeliveryPriceListService`; consumed by the HTTP layer so the FE offer-creation
 * wizard (single + bulk) can populate the delivery-price-list picker without
 * re-hitting the marketplace API on every render.
 *
 * @module libs/core/src/listings/application/interfaces
 */

import type { DeliveryPriceList } from '@openlinker/core/listings';

export interface IDeliveryPriceListService {
  /**
   * Return the delivery price lists for a connection.
   *
   * Resolves the connection's `OfferManager` adapter, narrows it to the
   * `DeliveryPriceListReader` capability, and returns the live options. The
   * adapter memoises the upstream response per connection so repeated wizard
   * loads do not hammer the marketplace API.
   *
   * Throws:
   * - `ConnectionNotFoundException` (→ HTTP 404) when the connection does not exist.
   * - `ConnectionDisabledException` (→ HTTP 409) when the connection is disabled.
   * - `CapabilityNotSupportedException` (→ HTTP 422) when the connection's
   *   adapter does not implement `OfferManager` at all.
   * - `UnprocessableEntityException` (→ HTTP 422) when the adapter supports
   *   `OfferManager` but does not implement `listDeliveryPriceLists`.
   */
  listDeliveryPriceLists(connectionId: string): Promise<DeliveryPriceList[]>;
}
