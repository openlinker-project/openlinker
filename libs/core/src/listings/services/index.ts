/**
 * Listings Services — impure runtime barrel
 *
 * NestJS module + the 8 Injectable service classes for the Listings bounded context.
 * Kept on a dedicated subpath (`@openlinker/core/listings/services`) so the
 * main `@openlinker/core/listings` barrel stays pure and safe to value-import
 * from any sibling package.
 *
 * Background: during #337 the main barrel re-exported both pure contracts
 * (ports/types/capabilities) and `@Injectable` services. When
 * `@openlinker/core/products` added a value import of `isOfferLister` through
 * the main barrel, Node's CJS loader reached the services, which import back
 * into `@openlinker/core/products`, creating a runtime cycle (Nest DI reported
 * `Symbol(?)` resolution failures). Split landed in #359.
 *
 * Consumers of this subpath today: `apps/api/src/listings/listings.module.ts`
 * and `apps/worker/src/sync/sync-worker.module.ts` (both consume
 * `ListingsModule`). Service interfaces, tokens, ports, and types remain on
 * the main barrel since they're type-only or pure Symbols.
 *
 * @module libs/core/src/listings/services
 */

export { ListingsModule } from '../listings.module';
export { OfferLinkingService } from '../application/services/offer-linking.service';
export { OfferMappingSyncService } from '../application/services/offer-mapping-sync.service';
export { OfferMappingsService } from '../application/services/offer-mappings.service';
export { CategoryResolutionService } from '../application/services/category-resolution.service';
export { AttributeProjectionService } from '../application/services/attribute-projection.service';
export { OfferBuilderService } from '../application/services/offer-builder.service';
export { OfferCreationExecutionService } from '../application/services/offer-creation-execution.service';
export { SellerPoliciesService } from '../application/services/seller-policies.service';
export { OfferCreationEnqueueService } from '../application/services/offer-creation-enqueue.service';
export { ProductPublishBuilderService } from '../application/services/product-publish-builder.service';
export { ProductPublishExecutionService } from '../application/services/product-publish-execution.service';
export { ProductPublishEnqueueService } from '../application/services/product-publish-enqueue.service';
export { ListingCreationQueryService } from '../application/services/listing-creation-query.service';
export { BulkShopPublishSubmitService } from '../application/services/bulk-shop-publish-submit.service';
