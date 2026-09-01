/**
 * Currency Context DI Tokens
 *
 * Symbol-only by convention (§ Symbol DI Token Re-export Convention): the
 * context barrel does `export * from './currency.tokens'`, so any non-Symbol
 * export added here would silently widen the public surface.
 *
 * @module libs/core/src/currency
 */

export const EXCHANGE_RATE_PROVIDER_REGISTRY_TOKEN = Symbol('ExchangeRateProviderRegistryPort');
export const EXCHANGE_RATE_REPOSITORY_TOKEN = Symbol('ExchangeRateRepositoryPort');
export const REPORTING_CURRENCY_SETTING_REPOSITORY_TOKEN = Symbol(
  'ReportingCurrencySettingRepositoryPort'
);
export const CURRENCY_RATE_SERVICE_TOKEN = Symbol('ICurrencyRateService');
export const EXCHANGE_RATE_LOOKUP_SERVICE_TOKEN = Symbol('IExchangeRateLookupService');
export const REPORTING_CURRENCY_SETTINGS_SERVICE_TOKEN = Symbol(
  'IReportingCurrencySettingsService'
);
