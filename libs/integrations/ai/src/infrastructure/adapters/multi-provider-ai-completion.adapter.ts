/**
 * Multi-Provider AI Completion Adapter (router)
 *
 * Bound to `AI_COMPLETION_PORT_TOKEN`. Holds a registry of every registered
 * provider adapter (anthropic Vercel, openai Vercel, fake) and, on each
 * `complete()` call, reads the active provider through
 * `IAiProviderActiveSettingsService` and delegates to the matching adapter.
 *
 * Empty on construction — `AiIntegrationModule.register()` populates the
 * registry via `register(provider, adapter)`. Mirrors the pattern introduced
 * in #570/#571 for `AdapterRegistryService`: integration modules own
 * registration; the router carries no platform-specific knowledge of which
 * providers exist. A community plugin can add a new provider (Cohere,
 * Mistral) by extending `AiProviderValues` and calling `register()` from
 * its own module — no constructor surgery required.
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
import { DuplicateAiProviderError } from '@openlinker/core/ai/domain/exceptions/duplicate-ai-provider.exception';
import type { IAiProviderActiveSettingsService } from '@openlinker/core/ai/application/services/ai-provider-active-settings.service.interface';

@Injectable()
export class MultiProviderAiCompletionAdapter implements AiCompletionPort {
  private readonly logger = new Logger(MultiProviderAiCompletionAdapter.name);
  private readonly adapters: Map<AiProvider, AiCompletionPort> = new Map();

  constructor(
    @Inject(AI_PROVIDER_ACTIVE_SETTINGS_SERVICE_TOKEN)
    private readonly activeSettings: IAiProviderActiveSettingsService,
  ) {}

  /**
   * Register a per-provider AI completion adapter on this router. Called by
   * `AiIntegrationModule.register()` once per provider at boot. Throws
   * `DuplicateAiProviderError` on a second registration for the same
   * provider — fail-loud at boot rather than silently overwrite.
   */
  register(provider: AiProvider, adapter: AiCompletionPort): void {
    if (this.adapters.has(provider)) {
      throw new DuplicateAiProviderError(provider);
    }
    this.adapters.set(provider, adapter);
    this.logger.log(`Registered AI completion adapter for provider: ${provider}`);
  }

  async complete(input: AiCompletionInput): Promise<AiCompletionResult> {
    const provider = await this.activeSettings.getActive();
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      // Defensive — should be unreachable when `AiIntegrationModule.register()`
      // covers every member of `AiProviderValues`. If we add a provider to
      // the value set and forget to register an adapter for it, this surfaces
      // it immediately.
      throw new AiCompletionError(
        `No AI completion adapter registered for active provider '${provider}'. ` +
          `Registered: [${Array.from(this.adapters.keys()).join(', ')}]`,
      );
    }
    this.logger.debug(`[ai] route requestId=${input.requestId ?? '-'} provider=${provider}`);
    return adapter.complete(input);
  }
}
