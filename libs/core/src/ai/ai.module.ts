/**
 * AI Module (core)
 *
 * NestJS module for the AI bounded context. Wires:
 *   - The `prompt_templates` ORM entity, TypeORM repository, and
 *     `PromptTemplateService` (#341).
 *   - The provider-key resolver (`CredentialsAiProviderAdapter` →
 *     `AI_PROVIDER_CREDENTIALS_PORT_TOKEN`) and the admin write-side
 *     `AiProviderKeyService` (`AI_PROVIDER_KEY_SERVICE_TOKEN`).
 *   - The active-provider singleton repository + `AiProviderActiveSettingsService`
 *     (`AI_PROVIDER_ACTIVE_SETTINGS_SERVICE_TOKEN`) — drives the runtime
 *     active selection consumed by `MultiProviderAiCompletionAdapter`.
 *
 * The Vercel / Fake completion adapters and the multi-provider router live
 * in `libs/integrations/ai/` and are registered through
 * `AiIntegrationModule`. That module imports this one to resolve the
 * credential resolver + active-settings service tokens.
 *
 * @module libs/core/src/ai
 */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CryptoService } from '@openlinker/shared';
import { IntegrationsModule as CoreIntegrationsModule } from '../integrations/integrations.module';
import {
  AI_PROVIDER_ACTIVE_SETTING_REPOSITORY_TOKEN,
  AI_PROVIDER_ACTIVE_SETTINGS_SERVICE_TOKEN,
  AI_PROVIDER_CREDENTIALS_PORT_TOKEN,
  AI_PROVIDER_KEY_SERVICE_TOKEN,
  PROMPT_TEMPLATE_REPOSITORY_TOKEN,
  PROMPT_TEMPLATE_SERVICE_TOKEN,
} from './ai.tokens';
import { AiProviderActiveSettingsService } from './application/services/ai-provider-active-settings.service';
import { AiProviderKeyService } from './application/services/ai-provider-key.service';
import { PromptTemplateService } from './application/services/prompt-template.service';
import { CredentialsAiProviderAdapter } from './infrastructure/adapters/credentials-ai-provider.adapter';
import { AiProviderActiveSettingOrmEntity } from './infrastructure/persistence/entities/ai-provider-active-setting.orm-entity';
import { PromptTemplateOrmEntity } from './infrastructure/persistence/entities/prompt-template.orm-entity';
import { AiProviderActiveSettingRepository } from './infrastructure/persistence/repositories/ai-provider-active-setting.repository';
import { PromptTemplateRepository } from './infrastructure/persistence/repositories/prompt-template.repository';

@Module({
  imports: [
    ConfigModule,
    // For INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN consumed by the credentials
    // adapter and the key service.
    CoreIntegrationsModule,
    TypeOrmModule.forFeature([PromptTemplateOrmEntity, AiProviderActiveSettingOrmEntity]),
  ],
  providers: [
    // CoreIntegrationsModule provides CryptoService internally but does not
    // export it; we register it locally so the AI services and
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
    AiProviderKeyService,
    {
      provide: AI_PROVIDER_KEY_SERVICE_TOKEN,
      useExisting: AiProviderKeyService,
    },
    AiProviderActiveSettingRepository,
    {
      provide: AI_PROVIDER_ACTIVE_SETTING_REPOSITORY_TOKEN,
      useExisting: AiProviderActiveSettingRepository,
    },
    AiProviderActiveSettingsService,
    {
      provide: AI_PROVIDER_ACTIVE_SETTINGS_SERVICE_TOKEN,
      useExisting: AiProviderActiveSettingsService,
    },
  ],
  exports: [
    PROMPT_TEMPLATE_REPOSITORY_TOKEN,
    PROMPT_TEMPLATE_SERVICE_TOKEN,
    AI_PROVIDER_CREDENTIALS_PORT_TOKEN,
    AI_PROVIDER_KEY_SERVICE_TOKEN,
    AI_PROVIDER_ACTIVE_SETTING_REPOSITORY_TOKEN,
    AI_PROVIDER_ACTIVE_SETTINGS_SERVICE_TOKEN,
  ],
})
export class AiModule {}
