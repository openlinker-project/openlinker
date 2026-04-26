/**
 * AI Provider Settings Service Interface
 *
 * Application-layer contract for managing the active AI provider's API key.
 * Backed by the encrypted `integration_credentials` store; consumed by the
 * `AiProviderSettingsController` admin endpoints.
 *
 * Co-located with the implementation, matching `prompt-template.service.interface.ts`
 * — the local convention for the `libs/core/src/ai/` bounded context.
 *
 * @module libs/core/src/ai/application/services
 */
import type { AiProviderSettingsView } from '../../domain/types/ai-provider-credentials.types';

export interface IAiProviderSettingsService {
  /**
   * Current settings view: which provider is active, whether a key is
   * configured, and where the key resolves from. Never returns the key.
   */
  get(): Promise<AiProviderSettingsView>;

  /**
   * Persist a new API key for the active provider.
   *
   * Throws `AiProviderSettingsNotApplicableError` when the active provider
   * does not require a key (e.g. `OL_AI_PROVIDER=fake`) — the controller
   * maps this to an HTTP 400.
   */
  set(apiKey: string, actorUserId?: string): Promise<void>;

  /**
   * Remove the stored key for the active provider, falling back to the env
   * fallback (or `none`).
   *
   * Throws `AiProviderSettingsNotApplicableError` when the active provider
   * does not require a key.
   */
  clear(actorUserId?: string): Promise<void>;
}
