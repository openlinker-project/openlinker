/**
 * AI Integration Module
 *
 * NestJS module that registers all AI completion adapters (one per
 * supported provider) plus the `MultiProviderAiCompletionAdapter` router
 * bound to `AI_COMPLETION_PORT_TOKEN`. Per-call routing is driven by the
 * persisted active-provider setting in core `AiModule`; `OL_AI_PROVIDER`
 * env is no longer read at module init — it remains the first-boot fallback
 * inside `AiProviderActiveSettingsService` when no DB row exists.
 *
 * The provider-key resolver (`AI_PROVIDER_CREDENTIALS_PORT_TOKEN`), the
 * `AiProviderKeyService`, and the `AiProviderActiveSettingsService` all
 * live in core `AiModule` — they are core code (ports + application
 * services + infrastructure adapters that talk only to the encrypted
 * credential store / singleton-row table), and DI registration follows the
 * code. This module imports core `AiModule` to resolve the credential port
 * (consumed by the per-provider Vercel adapters) and the active-settings
 * service (consumed by the router).
 *
 * Registered inside `apps/api/src/integrations/integrations.module.ts`
 * alongside `AllegroIntegrationModule` + `PrestashopIntegrationModule` —
 * not in `AppModule` directly — to keep all `@openlinker/integrations-*`
 * modules under one umbrella.
 *
 * @module libs/integrations/ai
 */
import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import {
  AI_COMPLETION_PORT_TOKEN,
  AI_PROVIDER_CREDENTIALS_PORT_TOKEN,
  AI_PROVIDER_ACTIVE_SETTINGS_SERVICE_TOKEN,
  AiModule as CoreAiModule,
} from '@openlinker/core/ai';
import type { AiCompletionPort } from '@openlinker/core/ai/domain/ports/ai-completion.port';
import type { AiProviderCredentialsPort } from '@openlinker/core/ai/domain/ports/ai-provider-credentials.port';
import type { IAiProviderActiveSettingsService } from '@openlinker/core/ai/application/services/ai-provider-active-settings.service.interface';
import { FakeAiCompletionAdapter } from './infrastructure/adapters/fake-ai-completion.adapter';
import {
  ANTHROPIC_AI_COMPLETION_ADAPTER_TOKEN,
  FAKE_AI_COMPLETION_ADAPTER_TOKEN,
  MultiProviderAiCompletionAdapter,
  OPENAI_AI_COMPLETION_ADAPTER_TOKEN,
} from './infrastructure/adapters/multi-provider-ai-completion.adapter';
import {
  VERCEL_GENERATE_TEXT_FN_TOKEN,
  VercelAiCompletionAdapter,
  type VercelGenerateTextFn,
} from './infrastructure/adapters/vercel-ai-completion.adapter';

@Module({})
export class AiIntegrationModule {
  static register(): DynamicModule {
    const completionAdapterProviders: Provider[] = [
      // Per-provider Vercel adapters — one instance each, locked to the
      // provider key at construction. The `useFactory` route keeps the
      // constructor's positional `provider` argument explicit.
      {
        provide: ANTHROPIC_AI_COMPLETION_ADAPTER_TOKEN,
        useFactory: (
          configService: ConfigService,
          credentials: AiProviderCredentialsPort,
          generateTextOverride?: VercelGenerateTextFn,
        ) =>
          new VercelAiCompletionAdapter(
            'anthropic',
            configService,
            credentials,
            generateTextOverride,
          ),
        inject: [
          ConfigService,
          AI_PROVIDER_CREDENTIALS_PORT_TOKEN,
          { token: VERCEL_GENERATE_TEXT_FN_TOKEN, optional: true },
        ],
      },
      {
        provide: OPENAI_AI_COMPLETION_ADAPTER_TOKEN,
        useFactory: (
          configService: ConfigService,
          credentials: AiProviderCredentialsPort,
          generateTextOverride?: VercelGenerateTextFn,
        ) =>
          new VercelAiCompletionAdapter(
            'openai',
            configService,
            credentials,
            generateTextOverride,
          ),
        inject: [
          ConfigService,
          AI_PROVIDER_CREDENTIALS_PORT_TOKEN,
          { token: VERCEL_GENERATE_TEXT_FN_TOKEN, optional: true },
        ],
      },
      FakeAiCompletionAdapter,
      {
        provide: FAKE_AI_COMPLETION_ADAPTER_TOKEN,
        useExisting: FakeAiCompletionAdapter,
      },
      // Router: AI_COMPLETION_PORT_TOKEN resolves to this; it dispatches
      // per-call to the right per-provider adapter based on the active
      // selection.
      {
        provide: MultiProviderAiCompletionAdapter,
        useFactory: (
          anthropicAdapter: AiCompletionPort,
          openaiAdapter: AiCompletionPort,
          fakeAdapter: AiCompletionPort,
          activeSettings: IAiProviderActiveSettingsService,
        ) =>
          new MultiProviderAiCompletionAdapter(
            anthropicAdapter,
            openaiAdapter,
            fakeAdapter,
            activeSettings,
          ),
        inject: [
          ANTHROPIC_AI_COMPLETION_ADAPTER_TOKEN,
          OPENAI_AI_COMPLETION_ADAPTER_TOKEN,
          FAKE_AI_COMPLETION_ADAPTER_TOKEN,
          AI_PROVIDER_ACTIVE_SETTINGS_SERVICE_TOKEN,
        ],
      },
      {
        provide: AI_COMPLETION_PORT_TOKEN,
        useExisting: MultiProviderAiCompletionAdapter,
      },
    ];

    return {
      module: AiIntegrationModule,
      imports: [ConfigModule, CoreAiModule],
      providers: [ConfigService, ...completionAdapterProviders],
      exports: [AI_COMPLETION_PORT_TOKEN],
    };
  }
}
