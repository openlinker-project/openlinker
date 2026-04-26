/**
 * AI Provider Settings — Frontend Types
 *
 * Hand-written wire types mirroring the backend DTOs in
 * `apps/api/src/ai/http/dto/ai-provider-settings-*.dto.ts`. Kept FE-local
 * so the web bundle stays independent of NestJS / core imports.
 *
 * @module apps/web/src/features/ai-provider-settings/api
 */

export const AiProviderValues = ['anthropic', 'fake'] as const;
export type AiProvider = (typeof AiProviderValues)[number];

/**
 * Where the API key currently resolves from on the server.
 *   - `db`   — encrypted row in `integration_credentials` (the source of truth)
 *   - `env`  — legacy `ANTHROPIC_API_KEY` env-var fallback (deprecated)
 *   - `none` — neither DB nor env has a key
 *
 * Resolution priority is **DB → env**: when both are set, the server reports
 * `db` and the env value is unused.
 */
export const AiProviderKeySourceValues = ['db', 'env', 'none'] as const;
export type AiProviderKeySource = (typeof AiProviderKeySourceValues)[number];

/**
 * Response shape for `GET /ai-provider-settings`. Never includes the key
 * value — the server cannot read it once stored.
 */
export interface AiProviderSettingsView {
  provider: AiProvider;
  configured: boolean;
  source: AiProviderKeySource;
}

/** Body for `PUT /ai-provider-settings`. The server trims `apiKey` before validating. */
export interface UpdateAiProviderSettingsInput {
  apiKey: string;
}
