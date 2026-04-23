/**
 * Content Module (core)
 *
 * NestJS module for the content bounded context. Wires the
 * `product_content_field` ORM entity into TypeORM, registers the repository,
 * the `ContentDraftService` (bound to `IContentDraftService` via token), and
 * the default `IntegrationsContentPublisher` (bound to `ContentPublisherPort`
 * via token).
 *
 * Imports `IntegrationsModule` so the publisher can resolve the
 * `ProductMaster` / `OfferManager` capability adapters at runtime, and
 * `ListingsModule` for `OfferMappingRepositoryPort` used by channel publishing.
 *
 * `CONTENT_SUGGESTION_SERVICE_TOKEN` is declared in `content.tokens.ts` but
 * bound to its concrete class in `apps/api/src/content/content.module.ts`
 * (the API layer). The suggestion service depends on `AI_COMPLETION_PORT_TOKEN`
 * which is only registered where `AiIntegrationModule` is imported — i.e. in
 * the API-side `IntegrationsModule`. Registering it at the core module level
 * would force `libs/core/src/content/` to import `@openlinker/integrations-ai`,
 * reversing the core → integration dependency direction. Keeping the
 * interface / token / class exports in core while the binding lives in api
 * is the OpenLinker convention for services whose concrete collaborators sit
 * in integration packages.
 *
 * @module libs/core/src/content
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationsModule } from '@openlinker/core/integrations';
import { ListingsModule } from '@openlinker/core/listings/services';
import { ContentDraftService } from './application/services/content-draft.service';
import { ContentStateReaderService } from './application/services/content-state-reader.service';
import { IntegrationsContentPublisher } from './application/services/integrations-content-publisher.service';
import {
  CONTENT_DRAFT_SERVICE_TOKEN,
  CONTENT_PUBLISHER_PORT_TOKEN,
  CONTENT_STATE_READER_SERVICE_TOKEN,
  PRODUCT_CONTENT_FIELD_REPOSITORY_TOKEN,
} from './content.tokens';
import { ProductContentFieldOrmEntity } from './infrastructure/persistence/entities/product-content-field.orm-entity';
import { ProductContentFieldRepository } from './infrastructure/persistence/repositories/product-content-field.repository';

export {
  CONTENT_DRAFT_SERVICE_TOKEN,
  CONTENT_PUBLISHER_PORT_TOKEN,
  CONTENT_STATE_READER_SERVICE_TOKEN,
  CONTENT_SUGGESTION_SERVICE_TOKEN,
  PRODUCT_CONTENT_FIELD_REPOSITORY_TOKEN,
} from './content.tokens';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProductContentFieldOrmEntity]),
    IntegrationsModule,
    ListingsModule,
  ],
  providers: [
    ProductContentFieldRepository,
    IntegrationsContentPublisher,
    ContentDraftService,
    ContentStateReaderService,
    {
      provide: PRODUCT_CONTENT_FIELD_REPOSITORY_TOKEN,
      useExisting: ProductContentFieldRepository,
    },
    {
      provide: CONTENT_PUBLISHER_PORT_TOKEN,
      useExisting: IntegrationsContentPublisher,
    },
    {
      provide: CONTENT_DRAFT_SERVICE_TOKEN,
      useExisting: ContentDraftService,
    },
    {
      provide: CONTENT_STATE_READER_SERVICE_TOKEN,
      useExisting: ContentStateReaderService,
    },
  ],
  exports: [
    PRODUCT_CONTENT_FIELD_REPOSITORY_TOKEN,
    CONTENT_PUBLISHER_PORT_TOKEN,
    CONTENT_DRAFT_SERVICE_TOKEN,
    CONTENT_STATE_READER_SERVICE_TOKEN,
  ],
})
export class ContentModule {}
