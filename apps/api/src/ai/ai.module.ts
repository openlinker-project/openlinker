/**
 * AI API Module
 *
 * NestJS module owning the HTTP surface for the AI bounded context. Both
 * controllers (`PromptTemplatesController` and `AiProviderSettingsController`)
 * resolve their dependencies from core `AiModule` — prompt-template service
 * + provider-settings service — so this module's only responsibility is
 * mounting controllers and importing the core module.
 *
 * Follows the `{domain}.module.ts` + `{Domain}ApiModule` pattern already
 * used by `ProductsApiModule` / `ListingsApiModule`.
 *
 * @module apps/api/src/ai
 */
import { Module } from '@nestjs/common';
import { AiModule as CoreAiModule } from '@openlinker/core/ai';
import { AiProviderSettingsController } from './http/ai-provider-settings.controller';
import { PromptTemplatesController } from './http/prompt-templates.controller';

@Module({
  imports: [CoreAiModule],
  controllers: [PromptTemplatesController, AiProviderSettingsController],
})
export class AiApiModule {}
