/**
 * AI Provider Active Settings Service
 *
 * Implements `IAiProviderActiveSettingsService`. The active provider lives
 * in the singleton `ai_provider_active_setting` table; on first boot when
 * no row exists, the read falls back to `OL_AI_PROVIDER` env and finally
 * to `'anthropic'`. A `setActive` call refuses to switch to a provider
 * with no key configured (DB or env) — the HTTP layer maps the resulting
 * `AiProviderActivationError` to 422.
 *
 * Read-through model: no in-process cache. The router
 * (`MultiProviderAiCompletionAdapter`) hits `getActive()` per completion;
 * the cost is a singleton-row PK lookup, dwarfed by the LLM round-trip.
 * No invalidator port is required, which keeps `AiModule` (where this
 * service lives) free of any back-edge to `AiIntegrationModule` (where
 * the router lives).
 *
 * @module libs/core/src/ai/application/services
 * @implements {IAiProviderActiveSettingsService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@openlinker/shared/logging';
import {
  AI_PROVIDER_ACTIVE_SETTING_REPOSITORY_TOKEN,
  AI_PROVIDER_CREDENTIALS_PORT_TOKEN,
} from '../../ai.tokens';
import type { AiProviderActiveSettingRepositoryPort } from '../../domain/ports/ai-provider-active-setting-repository.port';
import type { AiProviderCredentialsPort } from '../../domain/ports/ai-provider-credentials.port';
import { AiProviderValues, type AiProvider } from '../../domain/types/ai-completion.types';
import {
  ENV_VAR_BY_PROVIDER,
  providerRequiresKey,
} from '../../domain/types/ai-provider-credentials.types';
import { AiProviderActivationError } from '../../domain/exceptions/ai-provider-activation.exception';
import type {
  IAiProviderActiveSettingsService,
  MultiProviderSettingsView,
} from './ai-provider-active-settings.service.interface';

const DEFAULT_PROVIDER: AiProvider = 'anthropic';

const isAiProvider = (value: string): value is AiProvider =>
  (AiProviderValues as readonly string[]).includes(value);

@Injectable()
export class AiProviderActiveSettingsService implements IAiProviderActiveSettingsService {
  private readonly logger = new Logger(AiProviderActiveSettingsService.name);

  constructor(
    @Inject(AI_PROVIDER_ACTIVE_SETTING_REPOSITORY_TOKEN)
    private readonly repository: AiProviderActiveSettingRepositoryPort,
    @Inject(AI_PROVIDER_CREDENTIALS_PORT_TOKEN)
    private readonly credentials: AiProviderCredentialsPort,
    private readonly configService: ConfigService,
  ) {}

  async getActive(): Promise<AiProvider> {
    const resolved = await this.resolveActive();
    // Surface a misconfigured-on-boot state (active provider needs a key but
    // none is configured) at the read site so the operator sees it before
    // the next AI request fails with `AiProviderKeyMissingError`. The check
    // is fire-and-forget — it must not delay the hot path on the read, and
    // it is intentionally only emitted from the public read entry point so
    // internal call sites (e.g. `setActive` reading the prior value for the
    // audit log) don't trigger a redundant credential describe.
    if (providerRequiresKey(resolved)) {
      void this.warnIfActiveProviderMisconfigured(resolved);
    }
    return resolved;
  }

  async setActive(provider: AiProvider, actorUserId?: string): Promise<void> {
    // Guard: refuse to activate a provider that needs a key but doesn't have
    // one. Letting this through would silently break every subsequent
    // completion with `AiProviderKeyMissingError` and leave the operator
    // chasing a UI affordance that already returned 204.
    if (providerRequiresKey(provider)) {
      const view = await this.credentials.describe(provider);
      if (!view.configured) {
        throw new AiProviderActivationError(
          provider,
          ENV_VAR_BY_PROVIDER[provider] ?? null,
        );
      }
    }

    const previous = await this.resolveActive();
    await this.repository.upsertActive(provider, actorUserId ?? null);

    this.logger.log('ai_provider.set_active', {
      fromProvider: previous,
      toProvider: provider,
      actor: actorUserId ?? 'system',
    });
  }

  async getMultiProviderView(): Promise<MultiProviderSettingsView> {
    const [row, providers] = await Promise.all([
      this.repository.findActive(),
      this.credentials.describeAll(),
    ]);
    const activeProvider = row ? row.activeProvider : this.resolveEnvFallback();
    return {
      activeProvider,
      activeUpdatedAt: row?.updatedAt ?? null,
      activeUpdatedBy: row?.updatedBy ?? null,
      providers,
    };
  }

  /**
   * Pure DB → env → default resolution with no side effects. Internal
   * callers (e.g. `setActive` reading the prior selection) use this to
   * avoid the warning path that the public `getActive` triggers.
   */
  private async resolveActive(): Promise<AiProvider> {
    const row = await this.repository.findActive();
    return row ? row.activeProvider : this.resolveEnvFallback();
  }

  private resolveEnvFallback(): AiProvider {
    const raw = this.configService.get<string>('OL_AI_PROVIDER');
    if (typeof raw === 'string' && isAiProvider(raw)) {
      return raw;
    }
    return DEFAULT_PROVIDER;
  }

  private async warnIfActiveProviderMisconfigured(provider: AiProvider): Promise<void> {
    try {
      const view = await this.credentials.describe(provider);
      if (!view.configured) {
        this.logger.warn(
          `Active AI provider '${provider}' has no API key configured (DB or env). ` +
            `Subsequent AI requests will fail until a key is set via PUT /ai-provider-settings/keys/${provider} ` +
            `or the provider is switched to one that has one.`,
        );
      }
    } catch {
      // describe() failures are logged inside the credentials adapter; no need
      // to escalate here — this is a best-effort warning.
    }
  }
}
