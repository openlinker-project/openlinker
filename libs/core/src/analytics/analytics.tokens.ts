/**
 * Analytics Module Dependency Injection Tokens
 *
 * Symbol tokens for dependency injection in the analytics bounded context.
 *
 * @module libs/core/src/analytics
 */

export const POSTHOG_SETTINGS_REPOSITORY_TOKEN = Symbol('PosthogSettingsRepositoryPort');
export const POSTHOG_SETTINGS_SERVICE_TOKEN = Symbol('IPosthogSettingsService');

export const ANALYTICS_DISPLAY_SETTINGS_REPOSITORY_TOKEN = Symbol(
  'AnalyticsDisplaySettingsRepositoryPort'
);
export const ANALYTICS_DISPLAY_SETTINGS_SERVICE_TOKEN = Symbol('IAnalyticsDisplaySettingsService');
