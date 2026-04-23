/**
 * AI Module (core)
 *
 * NestJS module for the AI bounded context — wires the `prompt_templates`
 * ORM entity, the TypeORM repository, and the `PromptTemplateService` into
 * DI. Bound via Symbol tokens so consumers depend only on the port + service
 * interface, never on the concrete classes.
 *
 * The AI adapter (Vercel / Anthropic / Fake) lives in
 * `libs/integrations/ai/` and is registered separately through
 * `AiIntegrationModule`. Those two modules intentionally do not overlap —
 * one owns the port + provider-agnostic code, the other owns the adapter.
 *
 * @module libs/core/src/ai
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PROMPT_TEMPLATE_REPOSITORY_TOKEN, PROMPT_TEMPLATE_SERVICE_TOKEN } from './ai.tokens';
import { PromptTemplateService } from './application/services/prompt-template.service';
import { PromptTemplateOrmEntity } from './infrastructure/persistence/entities/prompt-template.orm-entity';
import { PromptTemplateRepository } from './infrastructure/persistence/repositories/prompt-template.repository';

@Module({
  imports: [TypeOrmModule.forFeature([PromptTemplateOrmEntity])],
  providers: [
    PromptTemplateRepository,
    PromptTemplateService,
    {
      provide: PROMPT_TEMPLATE_REPOSITORY_TOKEN,
      useExisting: PromptTemplateRepository,
    },
    {
      provide: PROMPT_TEMPLATE_SERVICE_TOKEN,
      useExisting: PromptTemplateService,
    },
  ],
  exports: [PROMPT_TEMPLATE_REPOSITORY_TOKEN, PROMPT_TEMPLATE_SERVICE_TOKEN],
})
export class AiModule {}
