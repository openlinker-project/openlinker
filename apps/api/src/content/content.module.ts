/**
 * Content API Module
 *
 * NestJS module owning the HTTP surface for the content bounded context —
 * the admin editor endpoints (#339) + the AI suggestion endpoint (#342).
 *
 * Binds `CONTENT_SUGGESTION_SERVICE_TOKEN` to `ContentSuggestionService` at
 * the API layer (not core) because the service depends on
 * `AI_COMPLETION_PORT_TOKEN`, which is only provided where
 * `AiIntegrationModule` is registered — i.e. inside the API-side
 * `IntegrationsModule`. See the core `content.module.ts` header for the
 * full rationale.
 *
 * @module apps/api/src/content
 */
import { Module } from '@nestjs/common';
import { AiModule as CoreAiModule } from '@openlinker/core/ai';
import {
  CONTENT_SUGGESTION_SERVICE_TOKEN,
  ContentModule as CoreContentModule,
} from '@openlinker/core/content';
import { ContentSuggestionService } from '@openlinker/core/content/application/services/content-suggestion.service';
import { IntegrationsModule as CoreIntegrationsModule } from '@openlinker/core/integrations';
import { ListingsModule as CoreListingsModule } from '@openlinker/core/listings/services';
import { IntegrationsModule } from '../integrations/integrations.module';
import { ContentController } from './http/content.controller';

@Module({
  imports: [
    CoreContentModule,
    CoreIntegrationsModule,
    CoreListingsModule,
    CoreAiModule,
    IntegrationsModule, // API-side — pulls in `AiIntegrationModule.register()` which binds `AI_COMPLETION_PORT_TOKEN`.
  ],
  controllers: [ContentController],
  providers: [
    ContentSuggestionService,
    {
      provide: CONTENT_SUGGESTION_SERVICE_TOKEN,
      useExisting: ContentSuggestionService,
    },
  ],
  exports: [CONTENT_SUGGESTION_SERVICE_TOKEN],
})
export class ContentApiModule {}
