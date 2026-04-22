/**
 * AI Completion Types
 *
 * Domain types for AI completion requests and responses. Provider-agnostic —
 * no SDK shapes from the underlying provider leak through these types.
 *
 * @module libs/core/src/ai/domain/types
 */

/**
 * Runtime array of supported AI provider keys. Used by AiIntegrationModule
 * to select an adapter at boot. `'fake'` is the deterministic offline adapter
 * used in tests and `OL_AI_PROVIDER=fake` local dev.
 */
export const AiProviderValues = ['anthropic', 'fake'] as const;
export type AiProvider = (typeof AiProviderValues)[number];

/**
 * Input payload for a single completion call.
 *
 * `cacheSystemPrompt` defaults to `true` in the adapter; set `false` only when
 * the system prompt is genuinely per-call (no reuse across requests). Anthropic's
 * cache silently no-ops below ~1024 input tokens, so a `cachedInputTokens === 0`
 * result on a short prompt is expected, not a failure.
 */
export interface AiCompletionInput {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  maxOutputTokens?: number;
  temperature?: number;
  cacheSystemPrompt?: boolean;
  requestId?: string;
}

export interface AiCompletionUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

export interface AiCompletionResult {
  text: string;
  usage: AiCompletionUsage;
  modelUsed: string;
  latencyMs: number;
}
