/**
 * AI Integration Module
 *
 * NestJS module that selects an AiCompletionPort adapter based on
 * `OL_AI_PROVIDER` (default: `anthropic`; `fake` for tests / offline dev) and
 * binds the chosen instance to `AI_COMPLETION_PORT_TOKEN` via `useExisting`.
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
import { AI_COMPLETION_PORT_TOKEN } from '@openlinker/core/ai/ai.tokens';
import { AiProviderValues, type AiProvider } from '@openlinker/core/ai/domain/types/ai-completion.types';
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

    const providers: Provider[] =
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
      imports: [ConfigModule],
      providers: [ConfigService, ...providers],
      exports: [AI_COMPLETION_PORT_TOKEN],
    };
  }
}
