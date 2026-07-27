/**
 * Shop Category Browse Service (#1834)
 *
 * Read service that returns a shop connection's existing category tree, one
 * parent level at a time, for the publish edit flow's category picker. Resolves
 * the connection's `ProductPublisher` adapter and narrows it to the
 * `ShopCategoryBrowser` sub-capability — the shop-side analogue of the
 * marketplace category browse used by the offer wizard.
 *
 * @module libs/core/src/listings/application/services
 * @implements {IShopCategoryBrowseService}
 * @see {@link IShopCategoryBrowseService} for the service contract
 */

import { Inject, Injectable, UnprocessableEntityException } from '@nestjs/common';

import { isShopCategoryBrowser } from '@openlinker/core/listings';
import { IIntegrationsService, INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import type { ShopCategory, ShopProductManagerPort } from '@openlinker/core/listings';

import type { IShopCategoryBrowseService } from '../interfaces/shop-category-browse.service.interface';

@Injectable()
export class ShopCategoryBrowseService implements IShopCategoryBrowseService {
  constructor(
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
  ) {}

  async browseCategories(connectionId: string, parentId?: string): Promise<ShopCategory[]> {
    // Throws ConnectionNotFoundException (404) / ConnectionDisabledException (409) /
    // CapabilityNotSupportedException (422) for upstream connection-level issues.
    const adapter = await this.integrationsService.getCapabilityAdapter<ShopProductManagerPort>(
      connectionId,
      'ProductPublisher',
    );

    if (!isShopCategoryBrowser(adapter)) {
      throw new UnprocessableEntityException(
        `Adapter for connection ${connectionId} does not support shop category browsing`,
      );
    }

    return adapter.browseCategories(parentId);
  }
}
