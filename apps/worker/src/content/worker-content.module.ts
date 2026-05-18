/**
 * Worker Content Module (#737)
 *
 * Binds `CONTENT_SUGGESTION_SERVICE_TOKEN` to `ContentSuggestionService` for
 * the worker process. Mirrors the `apps/api/src/content/content.module.ts`
 * suggestion-binding pattern — the suggestion service depends on
 * `AI_COMPLETION_PORT_TOKEN`, which the worker resolves via the worker-side
 * `IntegrationsModule` wrapper (`apps/worker/src/integrations/integrations.module.ts`),
 * which composes `workerPlugins` (including `AiIntegrationModule.register()`
 * as of #737) through `PluginRegistryModule.forRoot` and re-exports it.
 *
 * Cannot live in `libs/core/src/content/content.module.ts` because that
 * would force core to value-import `@openlinker/integrations-ai`,
 * reversing the core → integration dependency direction (see the core
 * `content.module.ts` file header for the full rationale). Per-host
 * mirror is the OpenLinker convention for services whose concrete
 * collaborators sit in integration packages.
 *
 * Slimmer than the API mirror: no controllers (worker has no HTTP
 * surface), no `ContentController` — just the suggestion-service
 * binding.
 *
 * @module apps/worker/src/content
 */
import { Module } from '@nestjs/common';
import { AiModule as CoreAiModule } from '@openlinker/core/ai';
import {
  CONTENT_SUGGESTION_SERVICE_TOKEN,
  ContentModule as CoreContentModule,
} from '@openlinker/core/content';
import { ContentSuggestionService } from '@openlinker/core/content';
import { IntegrationsModule as CoreIntegrationsModule } from '@openlinker/core/integrations';
import { ListingsModule as CoreListingsModule } from '@openlinker/core/listings/services';
import { IntegrationsModule } from '../integrations/integrations.module';

@Module({
  imports: [
    CoreContentModule,
    CoreIntegrationsModule,
    CoreListingsModule,
    CoreAiModule,
    IntegrationsModule, // `AI_COMPLETION_PORT_TOKEN` resolves via `PluginRegistryModule` re-export.
  ],
  providers: [
    ContentSuggestionService,
    {
      provide: CONTENT_SUGGESTION_SERVICE_TOKEN,
      useExisting: ContentSuggestionService,
    },
  ],
  exports: [CONTENT_SUGGESTION_SERVICE_TOKEN],
})
export class WorkerContentModule {}
