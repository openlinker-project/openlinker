/**
 * AI Module Dependency Injection Tokens
 *
 * Symbol tokens for AI module providers.
 *
 * - `AI_COMPLETION_PORT_TOKEN` is bound to the multi-provider router by
 *   `AiIntegrationModule` — at runtime the router resolves the active
 *   provider per call and delegates to the matching concrete adapter.
 * - The prompt-template tokens are bound by core `AiModule` to the
 *   in-process repository + service.
 * - `AI_PROVIDER_CREDENTIALS_PORT_TOKEN`, `AI_PROVIDER_KEY_SERVICE_TOKEN`,
 *   `AI_PROVIDER_ACTIVE_SETTING_REPOSITORY_TOKEN`, and
 *   `AI_PROVIDER_ACTIVE_SETTINGS_SERVICE_TOKEN` are bound by core `AiModule`
 *   so they share the credentials/persistence stack.
 *
 * @module libs/core/src/ai
 */
export const AI_COMPLETION_PORT_TOKEN = Symbol('AiCompletionPort');
export const PROMPT_TEMPLATE_REPOSITORY_TOKEN = Symbol('PromptTemplateRepositoryPort');
export const PROMPT_TEMPLATE_SERVICE_TOKEN = Symbol('IPromptTemplateService');
export const AI_PROVIDER_CREDENTIALS_PORT_TOKEN = Symbol('AiProviderCredentialsPort');
export const AI_PROVIDER_KEY_SERVICE_TOKEN = Symbol('IAiProviderKeyService');
export const AI_PROVIDER_ACTIVE_SETTING_REPOSITORY_TOKEN = Symbol(
  'AiProviderActiveSettingRepositoryPort',
);
export const AI_PROVIDER_ACTIVE_SETTINGS_SERVICE_TOKEN = Symbol(
  'IAiProviderActiveSettingsService',
);
