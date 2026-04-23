/**
 * AI Module Dependency Injection Tokens
 *
 * Symbol tokens for AI module providers. `AI_COMPLETION_PORT_TOKEN` is bound
 * to the configured adapter (Vercel/Anthropic or Fake) by
 * `AiIntegrationModule`. The prompt-template tokens are bound by the core
 * `AiModule` to the in-process repository + service.
 *
 * @module libs/core/src/ai
 */
export const AI_COMPLETION_PORT_TOKEN = Symbol('AiCompletionPort');
export const PROMPT_TEMPLATE_REPOSITORY_TOKEN = Symbol('PromptTemplateRepositoryPort');
export const PROMPT_TEMPLATE_SERVICE_TOKEN = Symbol('IPromptTemplateService');
