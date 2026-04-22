/**
 * AI Module Dependency Injection Tokens
 *
 * Symbol tokens for AI module providers. AI_COMPLETION_PORT_TOKEN is bound
 * to the configured adapter (Vercel/Anthropic or Fake) by AiIntegrationModule.
 *
 * @module libs/core/src/ai
 */
export const AI_COMPLETION_PORT_TOKEN = Symbol('AiCompletionPort');
