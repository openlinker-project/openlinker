/**
 * Content Module
 *
 * NestJS module for the content bounded context. Wires the
 * `product_content_field` ORM entity into TypeORM, registers the repository,
 * the `ContentDraftService` (bound to `IContentDraftService` via token), and
 * the default `IntegrationsContentPublisher` (bound to `ContentPublisherPort`
 * via token).
 *
 * Imports `IntegrationsModule` so the publisher can resolve the
 * `ProductMaster` capability adapter at publish time.
 *
 * @module libs/core/src/content
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IntegrationsModule } from '@openlinker/core/integrations';
import { ContentDraftService } from './application/services/content-draft.service';
import { IntegrationsContentPublisher } from './application/services/integrations-content-publisher.service';
import {
  CONTENT_DRAFT_SERVICE_TOKEN,
  CONTENT_PUBLISHER_PORT_TOKEN,
  PRODUCT_CONTENT_FIELD_REPOSITORY_TOKEN,
} from './content.tokens';
import { ProductContentFieldOrmEntity } from './infrastructure/persistence/entities/product-content-field.orm-entity';
import { ProductContentFieldRepository } from './infrastructure/persistence/repositories/product-content-field.repository';

export {
  CONTENT_DRAFT_SERVICE_TOKEN,
  CONTENT_PUBLISHER_PORT_TOKEN,
  PRODUCT_CONTENT_FIELD_REPOSITORY_TOKEN,
} from './content.tokens';

@Module({
  imports: [TypeOrmModule.forFeature([ProductContentFieldOrmEntity]), IntegrationsModule],
  providers: [
    ProductContentFieldRepository,
    IntegrationsContentPublisher,
    ContentDraftService,
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
  ],
  exports: [
    PRODUCT_CONTENT_FIELD_REPOSITORY_TOKEN,
    CONTENT_PUBLISHER_PORT_TOKEN,
    CONTENT_DRAFT_SERVICE_TOKEN,
  ],
})
export class ContentModule {}
