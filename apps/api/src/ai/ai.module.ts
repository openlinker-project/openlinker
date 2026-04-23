/**
 * AI API Module
 *
 * NestJS module owning the HTTP surface for the AI bounded context. Wires
 * the `PromptTemplatesController` against the core `AiModule` providers.
 * Follows the `{domain}.module.ts` + `{Domain}ApiModule` pattern already
 * used by `ProductsApiModule` / `ListingsApiModule`.
 *
 * @module apps/api/src/ai
 */
import { Module } from '@nestjs/common';
import { AiModule as CoreAiModule } from '@openlinker/core/ai';
import { PromptTemplatesController } from './http/prompt-templates.controller';

@Module({
  imports: [CoreAiModule],
  controllers: [PromptTemplatesController],
})
export class AiApiModule {}
