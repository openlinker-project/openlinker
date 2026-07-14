/**
 * Delivery Price List Service (#1530)
 *
 * Read service that returns a connection's seller-configured delivery price
 * lists ("cennik dostawy") for the offer-creation wizard. Resolves the
 * connection's `OfferManager` adapter and narrows it to the
 * `DeliveryPriceListReader` sub-capability; caching of the upstream response
 * lives in the adapter (per connection), mirroring the category-parameters
 * read path.
 *
 * @module libs/core/src/listings/application/services
 * @implements {IDeliveryPriceListService}
 * @see {@link IDeliveryPriceListService} for the service contract
 */

import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';

import { isDeliveryPriceListReader } from '@openlinker/core/listings';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import type { DeliveryPriceList, OfferManagerPort } from '@openlinker/core/listings';

import type { IDeliveryPriceListService } from '../interfaces/delivery-price-list.service.interface';

@Injectable()
export class DeliveryPriceListService implements IDeliveryPriceListService {
  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService
  ) {}

  async listDeliveryPriceLists(connectionId: string): Promise<DeliveryPriceList[]> {
    // Throws ConnectionNotFoundException (404) / ConnectionDisabledException (409) /
    // CapabilityNotSupportedException (422) for upstream connection-level issues.
    const adapter = await this.integrationsService.getCapabilityAdapter<OfferManagerPort>(
      connectionId,
      'OfferManager'
    );

    if (!isDeliveryPriceListReader(adapter)) {
      throw new UnprocessableEntityException(
        `Adapter for connection ${connectionId} does not support delivery-price-list listing`
      );
    }

    return adapter.listDeliveryPriceLists();
  }
}
