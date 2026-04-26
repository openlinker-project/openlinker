/**
 * AI Provider Credentials Types
 *
 * Shared shapes for the `AiProviderCredentialsPort` and the
 * `AiProviderSettingsService`. The single `AiProviderSettingsView` response
 * type is what both `port.describe()` and `service.get()` return — keeping
 * one type avoids drift between the port contract, the HTTP response, and
 * the FE TanStack Query type.
 *
 * @module libs/core/src/ai/domain/types
 */
import type { AiProvider } from './ai-completion.types';

/**
 * Where the API key currently resolves from.
 *
 *   - `db`   — encrypted row in `integration_credentials` at
 *              `ref = ai-provider:{provider}` (the source of truth).
 *   - `env`  — legacy fallback (`ANTHROPIC_API_KEY` env var). Surfaced as a
 *              warning state in the FE so admins migrate to DB storage.
 *   - `none` — neither DB nor env has a key. For `provider=fake` this is the
 *              expected steady state.
 *
 * Resolution priority is **DB → env**: when both are set, `db` is reported
 * and the env value is unused.
 */
export const AiProviderKeySourceValues = ['db', 'env', 'none'] as const;
export type AiProviderKeySource = (typeof AiProviderKeySourceValues)[number];

/**
 * Single response shape used by both the port (`describe()`) and the
 * settings service (`get()`). The HTTP response DTO maps 1:1 onto this.
 *
 * `apiKey` is intentionally absent from this type — the key value never
 * leaves the server in a response body.
 */
export interface AiProviderSettingsView {
  /** Active provider read from `OL_AI_PROVIDER` (default: `anthropic`). */
  provider: AiProvider;
  /** True when an API key is currently resolvable for the active provider. */
  configured: boolean;
  /** Where the key currently resolves from. */
  source: AiProviderKeySource;
}
