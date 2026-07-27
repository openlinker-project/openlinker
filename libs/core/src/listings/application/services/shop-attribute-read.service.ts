/**
 * Shop Attribute Read Service (#1835)
 *
 * Read service that returns a shop connection's store-wide global product
 * attributes and their predefined terms, for the publish edit flow's structured
 * attribute picker. Resolves the connection's `ProductPublisher` adapter and
 * narrows it to the `ShopAttributeReader` sub-capability — the read half that
 * lets an operator pick a real global attribute + terms (linked on publish),
 * with free-text custom attributes as the fallback.
 *
 * @module libs/core/src/listings/application/services
 * @implements {IShopAttributeReadService}
 * @see {@link IShopAttributeReadService} for the service contract
 */

import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';

import { isShopAttributeReader } from '@openlinker/core/listings';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import type {
  ShopAttribute,
  ShopAttributeReader,
  ShopAttributeTerm,
  ShopProductManagerPort,
} from '@openlinker/core/listings';

import type { IShopAttributeReadService } from '../interfaces/shop-attribute-read.service.interface';

@Injectable()
export class ShopAttributeReadService implements IShopAttributeReadService {
  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
  ) {}

  async listAttributes(connectionId: string): Promise<ShopAttribute[]> {
    const adapter = await this.resolveReader(connectionId);
    return adapter.listAttributes();
  }

  async listAttributeTerms(
    connectionId: string,
    attributeId: string,
  ): Promise<ShopAttributeTerm[]> {
    const adapter = await this.resolveReader(connectionId);
    return adapter.listAttributeTerms(attributeId);
  }

  private async resolveReader(
    connectionId: string,
  ): Promise<ShopProductManagerPort & ShopAttributeReader> {
    // Throws ConnectionNotFoundException (404) / ConnectionDisabledException (409) /
    // CapabilityNotSupportedException (422) for upstream connection-level issues.
    const adapter = await this.integrationsService.getCapabilityAdapter<ShopProductManagerPort>(
      connectionId,
      'ProductPublisher',
    );

    if (!isShopAttributeReader(adapter)) {
      throw new UnprocessableEntityException(
        `Adapter for connection ${connectionId} does not support shop attribute reading`,
      );
    }

    return adapter;
  }
}
