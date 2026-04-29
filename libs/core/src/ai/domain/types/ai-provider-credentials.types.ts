/**
 * AI Provider Credentials Types
 *
 * Shared shapes for the `AiProviderCredentialsPort` and consumers. The
 * single `AiProviderSettingsView` response type is what both
 * `port.describe()` and `IAiProviderKeyService.describe()` return —
 * keeping one type avoids drift between the port contract, the HTTP
 * response, and the FE TanStack Query type.
 *
 * @module libs/core/src/ai/domain/types
 */
import type { AiProvider } from './ai-completion.types';

/**
 * Where the API key currently resolves from.
 *
 *   - `db`   — encrypted row in `integration_credentials` at
 *              `ref = ai-provider:{provider}` (the source of truth).
 *   - `env`  — legacy fallback (e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`).
 *              Surfaced as a warning state in the FE so admins migrate to
 *              DB storage.
 *   - `none` — neither DB nor env has a key. For `provider=fake` this is the
 *              expected steady state.
 *
 * Resolution priority is **DB → env**: when both are set, `db` is reported
 * and the env value is unused.
 */
export const AiProviderKeySourceValues = ['db', 'env', 'none'] as const;
export type AiProviderKeySource = (typeof AiProviderKeySourceValues)[number];

/**
 * Per-provider env-var name for the legacy fallback path. Lives in the
 * domain layer so application services and the credentials adapter share
 * a single source of truth without crossing layer boundaries (services
 * must never import from infrastructure — see `engineering-standards.md`
 * "Layer Dependencies").
 *
 * Adding a provider that requires a key also requires adding its env-var
 * name here. The presence of an entry doubles as the "this provider needs
 * a key" predicate (via `providerRequiresKey`).
 */
export const ENV_VAR_BY_PROVIDER: Partial<Record<AiProvider, string>> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
};

/**
 * Domain predicate: does the provider require an API key for completion?
 * Drives both the credentials port (which throws
 * `AiProviderSettingsNotApplicableError` when called for a key-less
 * provider) and the active-settings service (which only guards activation
 * for providers that need a key).
 */
export const providerRequiresKey = (provider: AiProvider): boolean =>
  ENV_VAR_BY_PROVIDER[provider] !== undefined;

/**
 * Single response shape used by both the port (`describe()`) and the key
 * service (`describe()`). The HTTP response DTO maps 1:1 onto this.
 *
 * `apiKey` is intentionally absent from this type — the key value never
 * leaves the server in a response body.
 */
export interface AiProviderSettingsView {
  /** The provider this view describes. */
  provider: AiProvider;
  /** True when an API key is currently resolvable for the provider. */
  configured: boolean;
  /** Where the key currently resolves from. */
  source: AiProviderKeySource;
}
