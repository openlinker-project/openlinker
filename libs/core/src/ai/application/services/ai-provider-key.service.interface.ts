/**
 * AI Provider Key Service Interface
 *
 * Per-provider API-key management. Replaces the old
 * `IAiProviderSettingsService` whose contract conflated "key for the active
 * provider" with the active selection itself. Splitting the two surfaces
 * makes the wire shape (`PUT /ai-provider-settings/keys/:provider` vs
 * `PUT /ai-provider-settings/active`) read truthfully against the code.
 *
 * Backed by the encrypted `integration_credentials` table at
 * `ref = ai-provider:{provider}`; consumed by `AiProviderSettingsController`.
 *
 * @module libs/core/src/ai/application/services
 */
import type { AiProvider } from '../../domain/types/ai-completion.types';
import type { AiProviderSettingsView } from '../../domain/types/ai-provider-credentials.types';

export interface IAiProviderKeyService {
  /**
   * Status for a single provider — whether a key is configured and where it
   * resolves from (`db | env | none`). Never returns the key value.
   */
  describe(provider: AiProvider): Promise<AiProviderSettingsView>;

  /**
   * Status for every value in `AiProviderValues`. Used by the admin GET
   * endpoint to render the provider table without N+1 round-trips.
   */
  describeAll(): Promise<AiProviderSettingsView[]>;

  /**
   * Persist a new API key for `provider`. Throws
   * `AiProviderSettingsNotApplicableError` when the provider does not require
   * a key (e.g. `fake`). The HTTP layer maps that to 400.
   */
  setKey(provider: AiProvider, apiKey: string, actorUserId?: string): Promise<void>;

  /**
   * Remove the stored key for `provider`, falling back to the env fallback
   * (or `none`). Throws `AiProviderSettingsNotApplicableError` when the
   * provider does not require a key.
   */
  clearKey(provider: AiProvider, actorUserId?: string): Promise<void>;
}
