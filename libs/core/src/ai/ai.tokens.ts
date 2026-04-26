/**
 * AI Module Dependency Injection Tokens
 *
 * Symbol tokens for AI module providers. `AI_COMPLETION_PORT_TOKEN` is bound
 * to the configured adapter (Vercel/Anthropic or Fake) by
 * `AiIntegrationModule`. The prompt-template tokens are bound by the core
 * `AiModule` to the in-process repository + service. The
 * `AI_PROVIDER_CREDENTIALS_PORT_TOKEN` and `AI_PROVIDER_SETTINGS_SERVICE_TOKEN`
 * are bound by `AiIntegrationModule` (alongside the completion adapter) so
 * the credential resolver and the admin write-side service share the same
 * lifecycle as the adapter that consumes them.
 *
 * @module libs/core/src/ai
 */
export const AI_COMPLETION_PORT_TOKEN = Symbol('AiCompletionPort');
export const PROMPT_TEMPLATE_REPOSITORY_TOKEN = Symbol('PromptTemplateRepositoryPort');
export const PROMPT_TEMPLATE_SERVICE_TOKEN = Symbol('IPromptTemplateService');
export const AI_PROVIDER_CREDENTIALS_PORT_TOKEN = Symbol('AiProviderCredentialsPort');
export const AI_PROVIDER_SETTINGS_SERVICE_TOKEN = Symbol('IAiProviderSettingsService');
