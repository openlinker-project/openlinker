/**
 * Multi-Provider AI Completion Adapter (router)
 *
 * Bound to `AI_COMPLETION_PORT_TOKEN`. Holds a static map of every
 * registered provider adapter (anthropic Vercel, openai Vercel, fake) and,
 * on each `complete()` call, reads the active provider through
 * `IAiProviderActiveSettingsService` and delegates to the matching adapter.
 *
 * **No cache.** The active-provider lookup is a singleton-row PK query
 * against an indexed primary key — sub-millisecond. Compared to the
 * 200–2000 ms LLM round-trip the cost is invisible, and the read-through
 * approach buys: (1) instant cross-process visibility of an admin switch
 * (no TTL window), (2) no circular DI between core `AiModule` (where the
 * active-settings service lives) and `AiIntegrationModule` (where this
 * router lives) — an invalidator port would force the cycle.
 *
 * **Naming**: deviates from the strict `{System}{Capability}Adapter`
 * pattern in `engineering-standards.md` because this is a meta-adapter
 * with no `{System}` — it routes to system adapters. Documented inline so
 * a future reviewer doesn't quietly "fix" the name.
 *
 * @module libs/integrations/ai/infrastructure/adapters
 */
import { Inject, Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { AI_PROVIDER_ACTIVE_SETTINGS_SERVICE_TOKEN } from '@openlinker/core/ai/ai.tokens';
import type { AiCompletionPort } from '@openlinker/core/ai/domain/ports/ai-completion.port';
import type {
  AiCompletionInput,
  AiCompletionResult,
  AiProvider,
} from '@openlinker/core/ai/domain/types/ai-completion.types';
import { AiCompletionError } from '@openlinker/core/ai/domain/exceptions/ai-completion.exception';
import type { IAiProviderActiveSettingsService } from '@openlinker/core/ai/application/services/ai-provider-active-settings.service.interface';

export const ANTHROPIC_AI_COMPLETION_ADAPTER_TOKEN = Symbol('AnthropicAiCompletionAdapter');
export const OPENAI_AI_COMPLETION_ADAPTER_TOKEN = Symbol('OpenAiAiCompletionAdapter');
export const FAKE_AI_COMPLETION_ADAPTER_TOKEN = Symbol('FakeAiCompletionAdapter');

@Injectable()
export class MultiProviderAiCompletionAdapter implements AiCompletionPort {
  private readonly logger = new Logger(MultiProviderAiCompletionAdapter.name);
  private readonly adapters: Map<AiProvider, AiCompletionPort>;

  constructor(
    @Inject(ANTHROPIC_AI_COMPLETION_ADAPTER_TOKEN)
    anthropicAdapter: AiCompletionPort,
    @Inject(OPENAI_AI_COMPLETION_ADAPTER_TOKEN)
    openaiAdapter: AiCompletionPort,
    @Inject(FAKE_AI_COMPLETION_ADAPTER_TOKEN)
    fakeAdapter: AiCompletionPort,
    @Inject(AI_PROVIDER_ACTIVE_SETTINGS_SERVICE_TOKEN)
    private readonly activeSettings: IAiProviderActiveSettingsService,
  ) {
    this.adapters = new Map<AiProvider, AiCompletionPort>([
      ['anthropic', anthropicAdapter],
      ['openai', openaiAdapter],
      ['fake', fakeAdapter],
    ]);
  }

  async complete(input: AiCompletionInput): Promise<AiCompletionResult> {
    const provider = await this.activeSettings.getActive();
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      // Defensive — should be unreachable given the value-set guard at the
      // service layer. If we add a provider to `AiProviderValues` and forget
      // to register an adapter here, this surfaces it immediately.
      throw new AiCompletionError(
        `No AI completion adapter registered for active provider '${provider}'`,
      );
    }
    this.logger.debug(`[ai] route requestId=${input.requestId ?? '-'} provider=${provider}`);
    return adapter.complete(input);
  }
}
