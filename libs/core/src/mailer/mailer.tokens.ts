/**
 * Mailer Module Dependency Injection Tokens
 *
 * Symbol tokens for dependency injection in the mailer bounded context.
 *
 * @module libs/core/src/mailer
 */

export const MAILER_SETTINGS_REPOSITORY_TOKEN = Symbol('MailerSettingsRepositoryPort');
export const MAILER_SETTINGS_SERVICE_TOKEN = Symbol('IMailerSettingsService');
