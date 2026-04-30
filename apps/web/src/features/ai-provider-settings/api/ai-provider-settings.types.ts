/**
 * AI Provider Settings — Frontend Types
 *
 * Hand-written wire types mirroring the backend DTOs in
 * `apps/api/src/ai/http/dto/ai-provider-settings-*.dto.ts`. Kept FE-local
 * so the web bundle stays independent of NestJS / core imports.
 *
 * @module apps/web/src/features/ai-provider-settings/api
 */

export const AiProviderValues = ['anthropic', 'openai', 'fake'] as const;
export type AiProvider = (typeof AiProviderValues)[number];

/**
 * Where the API key currently resolves from on the server.
 *   - `db`   — encrypted row in `integration_credentials` (the source of truth)
 *   - `env`  — legacy provider-specific env-var fallback (deprecated)
 *   - `none` — neither DB nor env has a key
 *
 * Resolution priority is **DB → env**: when both are set, the server reports
 * `db` and the env value is unused.
 */
export const AiProviderKeySourceValues = ['db', 'env', 'none'] as const;
export type AiProviderKeySource = (typeof AiProviderKeySourceValues)[number];

/**
 * Per-provider key status row (one entry in `providers[]` of the GET
 * response). `provider=fake` always reports `configured=false / source=none`.
 */
export interface AiProviderRow {
  provider: AiProvider;
  configured: boolean;
  source: AiProviderKeySource;
}

/**
 * Response shape for `GET /ai-provider-settings`. Combines the active
 * selection with the per-provider key status. Never includes any key value
 * — the server cannot read keys once stored.
 */
export interface AiProviderSettingsView {
  activeProvider: AiProvider;
  /** ISO timestamp when the active selection last changed; `null` on env-fallback. */
  activeUpdatedAt: string | null;
  /** Username of the admin who last switched the active provider; `null` on env-fallback. */
  activeUpdatedBy: string | null;
  providers: AiProviderRow[];
}

/** Body for `PUT /ai-provider-settings/keys/:provider`. Server trims `apiKey`. */
export interface UpdateAiProviderKeyInput {
  apiKey: string;
}

/** Body for `PUT /ai-provider-settings/active`. */
export interface SetActiveAiProviderInput {
  provider: AiProvider;
}
