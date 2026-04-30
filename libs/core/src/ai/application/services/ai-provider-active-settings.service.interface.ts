/**
 * AI Provider Active Settings Service Interface
 *
 * Application-layer contract for managing which AI provider is active.
 * Distinct from `IAiProviderKeyService` (which manages per-provider key
 * storage) — keeping the two separate prevents the "settings" verb from
 * meaning two different things.
 *
 * Backed by the singleton `ai_provider_active_setting` table; resolution
 * falls back to `OL_AI_PROVIDER` env on first boot when no row exists.
 *
 * @module libs/core/src/ai/application/services
 */
import type { AiProvider } from '../../domain/types/ai-completion.types';
import type { AiProviderSettingsView } from '../../domain/types/ai-provider-credentials.types';

export interface MultiProviderSettingsView {
  /** Currently active provider — what `AI_COMPLETION_PORT_TOKEN` routes to. */
  activeProvider: AiProvider;
  /** When the active selection was last changed (null on first-boot env fallback). */
  activeUpdatedAt: Date | null;
  /** Who last changed the active selection (null on first-boot env fallback). */
  activeUpdatedBy: string | null;
  /** Per-provider key status, ordered by `AiProviderValues`. */
  providers: AiProviderSettingsView[];
}

export interface IAiProviderActiveSettingsService {
  /**
   * Resolve the currently active provider. DB row → `OL_AI_PROVIDER` env →
   * `'anthropic'` default.
   */
  getActive(): Promise<AiProvider>;

  /**
   * Persist a new active provider. Throws `AiProviderActivationError` when
   * the target provider requires a key and no key is configured (DB or env).
   */
  setActive(provider: AiProvider, actorUserId?: string): Promise<void>;

  /**
   * Composite read used by the admin `GET /ai-provider-settings` endpoint —
   * combines the active selection metadata with the per-provider key status.
   */
  getMultiProviderView(): Promise<MultiProviderSettingsView>;
}
