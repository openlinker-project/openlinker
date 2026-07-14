/**
 * Delivery Price List Reader Capability (#1530)
 *
 * Optional sub-capability of `OfferManagerPort` — adapters that can surface the
 * seller-configured delivery price lists ("cennik dostawy") required to make an
 * offer buyable declare `implements DeliveryPriceListReader`. The FE
 * offer-creation wizard renders these so the operator can attach one via
 * `CreateOfferCommand.overrides.platformParams`; without a delivery price list
 * the created offer lands not-buyable ("brak metody dostawy").
 *
 * See `seller-policies-reader.capability.ts` for the sibling read-capability
 * pattern and `offer-lister.capability.ts` for the shared naming convention.
 *
 * @module libs/core/src/listings/domain/ports/capabilities
 */
import type { DeliveryPriceList } from '../../types/delivery-price-list.types';
import type { OfferManagerPort } from '../offer-manager.port';

export interface DeliveryPriceListReader {
  listDeliveryPriceLists(): Promise<DeliveryPriceList[]>;
}

export function isDeliveryPriceListReader(
  adapter: OfferManagerPort,
): adapter is OfferManagerPort & DeliveryPriceListReader {
  return (
    typeof (adapter as Partial<DeliveryPriceListReader>).listDeliveryPriceLists === 'function'
  );
}
