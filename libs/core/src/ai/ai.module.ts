/**
 * AI Module (core)
 *
 * NestJS module for the AI bounded context. Wires:
 *   - The `prompt_templates` ORM entity, TypeORM repository, and
 *     `PromptTemplateService` (#341).
 *   - The provider-key resolver (`CredentialsAiProviderAdapter` →
 *     `AI_PROVIDER_CREDENTIALS_PORT_TOKEN`) and the admin write-side service
 *     (`AiProviderSettingsService` → `AI_PROVIDER_SETTINGS_SERVICE_TOKEN`)
 *     (#398). Both are core code, so DI registration lives here — mirroring
 *     the webhook-secret split (`WebhookSecretService` +
 *     `CredentialsWebhookSecretAdapter` are wired by core
 *     `IntegrationsModule`, not by the integrations package).
 *
 * The Vercel / Fake completion adapters live in `libs/integrations/ai/`
 * and are registered through `AiIntegrationModule`. That module imports
 * this one to resolve `AI_PROVIDER_CREDENTIALS_PORT_TOKEN` for the Vercel
 * adapter.
 *
 * @module libs/core/src/ai
 */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CryptoService } from '@openlinker/shared';
import { IntegrationsModule as CoreIntegrationsModule } from '../integrations/integrations.module';
import {
  AI_PROVIDER_CREDENTIALS_PORT_TOKEN,
  AI_PROVIDER_SETTINGS_SERVICE_TOKEN,
  PROMPT_TEMPLATE_REPOSITORY_TOKEN,
  PROMPT_TEMPLATE_SERVICE_TOKEN,
} from './ai.tokens';
import { AiProviderSettingsService } from './application/services/ai-provider-settings.service';
import { PromptTemplateService } from './application/services/prompt-template.service';
import { CredentialsAiProviderAdapter } from './infrastructure/adapters/credentials-ai-provider.adapter';
import { PromptTemplateOrmEntity } from './infrastructure/persistence/entities/prompt-template.orm-entity';
import { PromptTemplateRepository } from './infrastructure/persistence/repositories/prompt-template.repository';

@Module({
  imports: [
    ConfigModule,
    // For INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN consumed by the credentials
    // adapter and the settings service.
    CoreIntegrationsModule,
    TypeOrmModule.forFeature([PromptTemplateOrmEntity]),
  ],
  providers: [
    // CoreIntegrationsModule provides CryptoService internally but does not
    // export it; we register it locally so AiProviderSettingsService and
    // CredentialsAiProviderAdapter can construct.
    CryptoService,
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
    CredentialsAiProviderAdapter,
    {
      provide: AI_PROVIDER_CREDENTIALS_PORT_TOKEN,
      useExisting: CredentialsAiProviderAdapter,
    },
    AiProviderSettingsService,
    {
      provide: AI_PROVIDER_SETTINGS_SERVICE_TOKEN,
      useExisting: AiProviderSettingsService,
    },
  ],
  exports: [
    PROMPT_TEMPLATE_REPOSITORY_TOKEN,
    PROMPT_TEMPLATE_SERVICE_TOKEN,
    AI_PROVIDER_CREDENTIALS_PORT_TOKEN,
    AI_PROVIDER_SETTINGS_SERVICE_TOKEN,
  ],
})
export class AiModule {}
