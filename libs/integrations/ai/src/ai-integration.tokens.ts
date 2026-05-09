/**
 * AI Integration Module — DI Tokens
 *
 * Per-provider adapter DI tokens used by `AiIntegrationModule.register()` to
 * wire each provider's `VercelAiCompletionAdapter` (or `FakeAiCompletionAdapter`)
 * into the multi-provider router. Lives in its own file so adding a new
 * provider (Cohere, Mistral, …) is a one-token addition without touching the
 * router itself — mirrors the registry pattern in #570/#571.
 *
 * @module libs/integrations/ai/src
 */

export const ANTHROPIC_AI_COMPLETION_ADAPTER_TOKEN = Symbol('AnthropicAiCompletionAdapter');
export const OPENAI_AI_COMPLETION_ADAPTER_TOKEN = Symbol('OpenAiAiCompletionAdapter');
export const FAKE_AI_COMPLETION_ADAPTER_TOKEN = Symbol('FakeAiCompletionAdapter');
