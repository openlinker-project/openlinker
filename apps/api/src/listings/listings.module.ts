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
import { ListingsController } from './http/listings.controller';
import { BulkListingController } from './http/bulk-listing.controller';

@Module({
  // CoreIntegrationsModule supplies INTEGRATIONS_SERVICE_TOKEN, which the
  // controller injects to resolve the per-connection OfferManager adapter
  // for the category-parameters endpoint (#410).
  // CoreProductsModule supplies PRODUCT_VARIANT_REPOSITORY_TOKEN, used by
  // GET /listings/:id to resolve the linked variant's productId (#485).
  imports: [CoreListingsModule, CoreSyncModule, CoreIntegrationsModule, CoreProductsModule],
  controllers: [ListingsController, BulkListingController],
})
export class ListingsApiModule {}
