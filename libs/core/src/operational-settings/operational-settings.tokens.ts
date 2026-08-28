/**
 * Operational Settings Context DI Tokens
 *
 * Symbol-only by convention (§ Symbol DI Token Re-export Convention): the
 * context barrel does `export * from './operational-settings.tokens'`, so any
 * non-Symbol export added here would silently widen the public surface.
 *
 * @module libs/core/src/operational-settings
 */

export const OPERATIONAL_SETTINGS_REPOSITORY_TOKEN = Symbol('OperationalSettingsRepositoryPort');
export const OPERATIONAL_SETTINGS_SERVICE_TOKEN = Symbol('IOperationalSettingsService');
