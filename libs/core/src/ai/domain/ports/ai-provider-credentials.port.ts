/**
 * AI Provider Credentials Port
 *
 * Resolves the API key for the active AI provider (read from
 * `OL_AI_PROVIDER`). Used by the Vercel completion adapter on every
 * `complete()` call so key rotations apply without a restart.
 *
 * Resolution priority (DB wins when both are set):
 *   1. Encrypted row in `integration_credentials` at `ref = ai-provider:{provider}`
 *   2. `ConfigService.get('ANTHROPIC_API_KEY')` (legacy env-var fallback for local dev)
 *   3. throws `AiProviderKeyMissingError` if neither is set
 *
 * For `provider=fake`, `getApiKey()` should never be called — `FakeAiCompletionAdapter`
 * does not invoke the port. If invoked in fake mode, the implementation throws.
 *
 * @module libs/core/src/ai/domain/ports
 */
import type { AiProvider } from '../types/ai-completion.types';
import type { AiProviderSettingsView } from '../types/ai-provider-credentials.types';

/**
 * Build the credential `ref` for a given provider. Single source of truth
 * shared between `AiProviderSettingsService` (write side) and
 * `CredentialsAiProviderAdapter` (read side). Lives in the domain layer so
 * both application and infrastructure consumers depend on it through the
 * port file — never on each other. Mirrors `webhookSecretRef` placement at
 * `libs/core/src/integrations/domain/ports/webhook-secret-provider.port.ts`.
 */
export const aiProviderCredentialsRef = (provider: AiProvider): string =>
  `ai-provider:${provider}`;

export interface AiProviderCredentialsPort {
  /**
   * Resolve the API key for the active provider.
   *
   * @throws {AiProviderKeyMissingError} when no key is resolvable.
   */
  getApiKey(): Promise<string>;

  /**
   * Where the key currently resolves from, without exposing the value.
   * Safe to call in any provider mode (including `fake`).
   */
  describe(): Promise<AiProviderSettingsView>;

  /**
   * Drop the cached value. Called by `AiProviderSettingsService` after every
   * write (PUT / DELETE) so the next `getApiKey()` re-reads the credential
   * row.
   */
  invalidate(): void;
}
