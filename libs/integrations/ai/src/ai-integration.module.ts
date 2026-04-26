/**
 * AI Integration Module
 *
 * NestJS module that selects an `AiCompletionPort` adapter based on
 * `OL_AI_PROVIDER` (default: `anthropic`; `fake` for tests / offline dev) and
 * binds the chosen instance to `AI_COMPLETION_PORT_TOKEN` via `useExisting`.
 *
 * The provider-key resolver (`AI_PROVIDER_CREDENTIALS_PORT_TOKEN`) and the
 * admin write-side service (`AI_PROVIDER_SETTINGS_SERVICE_TOKEN`) live in
 * core `AiModule` — they are core code (port + application service +
 * infrastructure adapter that talks only to the encrypted credential
 * store), and DI registration follows the code. This module imports core
 * `AiModule` to resolve `AI_PROVIDER_CREDENTIALS_PORT_TOKEN` for the Vercel
 * completion adapter and re-exports it so downstream consumers wired
 * through this module can inject it too.
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
  AiModule as CoreAiModule,
  AiProviderValues,
  type AiProvider,
} from '@openlinker/core/ai';
import { Logger } from '@openlinker/shared/logging';
import { FakeAiCompletionAdapter } from './infrastructure/adapters/fake-ai-completion.adapter';
import { VercelAiCompletionAdapter } from './infrastructure/adapters/vercel-ai-completion.adapter';

const DEFAULT_PROVIDER: AiProvider = 'anthropic';

const isAiProvider = (value: string): value is AiProvider =>
  (AiProviderValues as readonly string[]).includes(value);

@Module({})
export class AiIntegrationModule {
  static register(): DynamicModule {
    const logger = new Logger(AiIntegrationModule.name);
    const rawProvider = process.env.OL_AI_PROVIDER ?? DEFAULT_PROVIDER;
    const provider: AiProvider = isAiProvider(rawProvider) ? rawProvider : DEFAULT_PROVIDER;

    if (rawProvider !== provider) {
      logger.warn(
        `Invalid OL_AI_PROVIDER value "${rawProvider}"; falling back to "${DEFAULT_PROVIDER}". Allowed values: ${AiProviderValues.join(', ')}.`,
      );
    } else {
      logger.log(`AiIntegrationModule using provider: ${provider}`);
    }

    const completionAdapterProviders: Provider[] =
      provider === 'fake'
        ? [
            FakeAiCompletionAdapter,
            { provide: AI_COMPLETION_PORT_TOKEN, useExisting: FakeAiCompletionAdapter },
          ]
        : [
            VercelAiCompletionAdapter,
            { provide: AI_COMPLETION_PORT_TOKEN, useExisting: VercelAiCompletionAdapter },
          ];

    return {
      module: AiIntegrationModule,
      imports: [ConfigModule, CoreAiModule],
      providers: [ConfigService, ...completionAdapterProviders],
      // Only AI_COMPLETION_PORT_TOKEN is owned by this module. Consumers
      // that need AI_PROVIDER_CREDENTIALS_PORT_TOKEN or
      // AI_PROVIDER_SETTINGS_SERVICE_TOKEN (e.g. AiApiModule) should import
      // CoreAiModule directly — re-exporting tokens from an imported
      // module is not supported by NestJS without re-exporting the module
      // itself, and the direct import is clearer anyway.
      exports: [AI_COMPLETION_PORT_TOKEN],
    };
  }
}
