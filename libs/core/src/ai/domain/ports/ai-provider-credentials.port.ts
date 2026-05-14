/**
 * AI Provider Credentials Port
 *
 * Resolves the API key for a named AI provider. Used by the per-provider
 * Vercel completion adapters on every `complete()` call so key rotations
 * apply without a restart.
 *
 * Resolution priority for each provider (DB wins when both are set):
 *   1. Encrypted row in `integration_credentials` at `ref = ai-provider:{provider}`
 *   2. Provider-specific env var (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`)
 *   3. throws `AiProviderKeyMissingError` if neither is set
 *
 * For `provider=fake`, neither `getApiKey` nor `describe` requires a key —
 * `describe` reports `{ provider: 'fake', configured: false, source: 'none' }`,
 * `getApiKey` throws `AiProviderSettingsNotApplicableError` (the fake
 * adapter never invokes it; if it does, that's a programming error).
 *
 * @module libs/core/src/ai/domain/ports
 */
import type { AiProvider } from '../types/ai-completion.types';
import type { AiProviderSettingsView } from '../types/ai-provider-credentials.types';

/**
 * Canonical credential ref prefix for per-provider AI keys.
 *
 * Exported separately from `aiProviderCredentialsRef` (#709) so the
 * credentials-encryption migration can dispatch on
 * `row.ref.startsWith(prefix)` against a typed constant rather than a
 * hardcoded string literal.
 */
export const AI_PROVIDER_CREDENTIALS_REF_PREFIX = 'ai-provider:';

/**
 * Build the credential `ref` for a given provider. Single source of truth
 * shared between the write side (`AiProviderKeyService`) and the read side
 * (`CredentialsAiProviderAdapter`). Lives in the domain layer so both
 * application and infrastructure consumers depend on it through the port
 * file — never on each other.
 */
export const aiProviderCredentialsRef = (provider: AiProvider): string =>
  `${AI_PROVIDER_CREDENTIALS_REF_PREFIX}${provider}`;

export interface AiProviderCredentialsPort {
  /**
   * Resolve the API key for the given provider.
   *
   * @throws {AiProviderKeyMissingError} when no key is resolvable.
   * @throws {AiProviderSettingsNotApplicableError} when the provider does
   *   not require a key (e.g. `fake`).
   */
  getApiKey(provider: AiProvider): Promise<string>;

  /**
   * Where the key for `provider` currently resolves from, without exposing
   * the value. Safe to call for every provider.
   */
  describe(provider: AiProvider): Promise<AiProviderSettingsView>;

  /**
   * Bulk variant of `describe()` covering every value in `AiProviderValues`.
   * Used by the admin `GET /ai-provider-settings` endpoint to render the
   * provider table without N+1 round-trips.
   */
  describeAll(): Promise<AiProviderSettingsView[]>;

  /**
   * Drop the cached value(s). Called by `AiProviderKeyService` after every
   * write (PUT / DELETE) so the next `getApiKey()` re-reads the credential
   * row. Omit `provider` to invalidate every entry.
   */
  invalidate(provider?: AiProvider): void;
}
