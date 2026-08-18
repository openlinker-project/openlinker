/**
 * Shop Category Browse Service (#1834, delegated to the projection in #2085)
 *
 * Read service that returns a shop connection's existing category tree, one
 * parent level at a time, for the publish edit flow's category picker.
 *
 * Since #2085 this reads the neutral `DestinationCategory` projection rather
 * than the live shop. It was the last shop-side read still calling the platform
 * directly, which contradicted ADR-037's defining property ("reads never touch
 * the live platform"); the `ShopCategoryBrowser` capability is now reached only
 * by the `destination.taxonomy.sync` job. #2074 deferred this because a
 * freshly created shop had no projection rows until the next hourly tick —
 * #2084's create/enable bootstrap closes that gap.
 *
 * The service survives as a thin mapping seam rather than being absorbed: it
 * owns the projection -> `ShopCategory` shape conversion, and its interface and
 * DI token are what the controller already depends on.
 *
 * @module libs/core/src/listings/application/services
 * @implements {IShopCategoryBrowseService}
 * @see {@link IShopCategoryBrowseService} for the service contract
 * @see {@link IDestinationTaxonomyService} for the projection read
 */

import { Inject, Injectable } from '@nestjs/common';

import type { ShopCategory } from '@openlinker/core/listings';

import { IDestinationTaxonomyService } from '../interfaces/destination-taxonomy.service.interface';
import type { IShopCategoryBrowseService } from '../interfaces/shop-category-browse.service.interface';
import { DESTINATION_TAXONOMY_SERVICE_TOKEN } from '../../listings.tokens';

@Injectable()
export class ShopCategoryBrowseService implements IShopCategoryBrowseService {
  constructor(
    @Inject(DESTINATION_TAXONOMY_SERVICE_TOKEN)
    private readonly destinationTaxonomy: IDestinationTaxonomyService,
  ) {}

  async browseCategories(connectionId: string, parentId?: string): Promise<ShopCategory[]> {
    // NOTE the error-shape change, which is wider than swapping one exception
    // type. The live path distinguished three connection-level failures via
    // `getCapabilityAdapter` — not-found (404), disabled (409), capability
    // unsupported (422). `browse` resolves the scope through `tryGetAdapter`,
    // which swallows ALL of them to probe the destination kind, so every one
    // now surfaces as TaxonomySourceUnavailableException (422).
    //
    // Accepted rather than worked around: restoring the split would mean
    // re-injecting IIntegrationsService to pre-check the connection, undoing
    // the point of the delegation, and it would diverge from the sibling
    // marketplace route (#2074), which resolves scope the same way. Whether
    // `resolveScope` should preserve not-found / disabled is a question about
    // core's own error semantics on every taxonomy read, filed separately.
    const categories = await this.destinationTaxonomy.browse(connectionId, parentId);

    return categories.map((category) => ({
      id: category.externalId,
      name: category.name,
      parentId: category.parentId,
    }));
  }
}
