/**
 * Listings API Module
 *
 * NestJS module for listings/offer mapping read API endpoints. Imports core
 * listings module and registers the listings controller.
 *
 * @module apps/api/src/listings
 */
import { Module } from '@nestjs/common';
import { IntegrationsModule as CoreIntegrationsModule } from '@openlinker/core/integrations';
import { ListingsModule as CoreListingsModule } from '@openlinker/core/listings/services';
import { ProductsModule as CoreProductsModule } from '@openlinker/core/products';
import { SyncModule as CoreSyncModule } from '@openlinker/core/sync';
// The APP-LAYER integrations module (distinct from `CoreIntegrationsModule`
// above) — supplies `CONNECTION_SERVICE_TOKEN` (`IConnectionService`),
// which `PriceSyncModeOverrideService` needs for its validated,
// concurrency-safe `Connection.config` write (#3162 review). No cycle:
// `IntegrationsModule` (apps/api) imports the CORE `ListingsModule`, a
// different class from this one, never this app-layer module.
import { IntegrationsModule } from '../integrations/integrations.module';
import { ListingsController } from './http/listings.controller';
import { BulkListingController } from './http/bulk-listing.controller';
import { ShopPublishController } from './http/shop-publish.controller';
import { BulkShopPublishController } from './http/bulk-shop-publish.controller';
import { DescriptionFormatController } from './http/description-format.controller';
import { TaxonomyController } from './http/taxonomy.controller';
import { PriceChangesController } from './http/price-changes.controller';
import { PriceSyncModeOverrideService } from './application/services/price-sync-mode-override.service';
import { PRICE_SYNC_MODE_OVERRIDE_SERVICE_TOKEN } from './application/services/price-sync-mode-override.service.interface';

@Module({
  // CoreIntegrationsModule supplies INTEGRATIONS_SERVICE_TOKEN, which the
  // controller injects to resolve the per-connection OfferManager adapter
  // for the category-parameters endpoint (#410).
  // CoreProductsModule supplies PRODUCT_VARIANT_REPOSITORY_TOKEN, used by
  // GET /listings/:id to resolve the linked variant's productId (#485).
  imports: [
    CoreListingsModule,
    CoreSyncModule,
    CoreIntegrationsModule,
    CoreProductsModule,
    IntegrationsModule,
  ],
  controllers: [
    // PriceChangesController is registered FIRST (#3162 review — BLOCKING):
    // Nest matches routes in controller-REGISTRATION order with no
    // static-before-dynamic sorting, and `ListingsController`'s
    // `@Get(':id')` would otherwise shadow `GET /listings/price-changes`
    // (matching it as `GET /listings/:id` with `id='price-changes'`,
    // rejected 400 by that route's `ParseUUIDPipe`). Pinned by
    // `apps/api/test/integration/price-changes-route-shadowing.int-spec.ts`
    // so a future re-sort of this array regresses loudly.
    PriceChangesController,
    ListingsController,
    BulkListingController,
    ShopPublishController,
    BulkShopPublishController,
    TaxonomyController,
    DescriptionFormatController,
  ],
  providers: [
    PriceSyncModeOverrideService,
    { provide: PRICE_SYNC_MODE_OVERRIDE_SERVICE_TOKEN, useExisting: PriceSyncModeOverrideService },
  ],
})
export class ListingsApiModule {}
