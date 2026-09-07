/**
 * Currency Context Public API
 *
 * The rate contract, the provider registry, the pure rate-date / rate-source
 * rules, the shared `exchange_rates` registry and the system-level
 * reporting-currency setting (ADR-040).
 *
 * A LEAF context: nothing here imports a sibling `@openlinker/core/*` context,
 * and nothing here speaks HTTP. Provider implementations live in
 * `@openlinker/integrations-fx`.
 *
 * @module libs/core/src/currency
 */

// Types
export {
  FX_RATE_RULES,
  DEFAULT_FX_RATE_RULE,
  isFxRateRule,
} from './domain/types/fx-rate-rule.types';
export type { FxRateRule } from './domain/types/fx-rate-rule.types';

export {
  EXCHANGE_RATE_SOURCES,
  RATE_DERIVATION_KINDS,
  isExchangeRateSource,
} from './domain/types/exchange-rate.types';
export type {
  ExchangeRate,
  ExchangeRateKey,
  ExchangeRateSource,
  FetchRateInput,
  GetRateInput,
  RateDerivation,
  RateDerivationKind,
  RateDerivationLeg,
  StoredExchangeRate,
} from './domain/types/exchange-rate.types';

export {
  DEFAULT_REPORTING_CURRENCY,
  REPORTING_CURRENCY_ENV_VAR,
  REPORTING_CURRENCY_SOURCES,
  SUPPORTED_REPORTING_CURRENCIES,
  isSupportedReportingCurrency,
} from './domain/types/reporting-currency.types';
export type {
  ReportingCurrencyCoverage,
  ReportingCurrencySettingsView,
  ReportingCurrencySource,
  SetReportingCurrencyOptions,
  SupportedReportingCurrency,
} from './domain/types/reporting-currency.types';

// Pure domain rules
export { resolveRateDate } from './domain/rate-date-resolution';
export { resolveRateSource } from './domain/rate-source-resolution';
export { assessCoverage } from './domain/coverage-assessment';

// Entities
export {
  ReportingCurrencySetting,
  REPORTING_CURRENCY_SETTING_SINGLETON_ID,
} from './domain/entities/reporting-currency-setting.entity';

// Ports
export type { ExchangeRateProviderPort } from './domain/ports/exchange-rate-provider.port';
export type { ExchangeRateProviderRegistryPort } from './domain/ports/exchange-rate-provider-registry.port';
export type { ExchangeRateRepositoryPort } from './domain/ports/exchange-rate-repository.port';
export type { ReportingCurrencySettingRepositoryPort } from './domain/ports/reporting-currency-setting-repository.port';

// Exceptions
export {
  DuplicateExchangeRateError,
  RateUnavailableTransientError,
  RateUnsupportedPairError,
} from './domain/exceptions/exchange-rate.exception';
export {
  DuplicateExchangeRateSourceError,
  NoExchangeRateProvidersRegisteredError,
  UnregisteredExchangeRateSourceError,
} from './domain/exceptions/exchange-rate-source.exception';
export {
  InvalidReportingCurrencyError,
  ReportingCurrencyUnsupportedError,
} from './domain/exceptions/reporting-currency.exception';

// Application service interfaces
export type { ICurrencyRateService } from './application/interfaces/currency-rate.service.interface';
export type { IExchangeRateLookupService } from './application/interfaces/exchange-rate-lookup.service.interface';
export type { IReportingCurrencySettingsService } from './application/interfaces/reporting-currency-settings.service.interface';

// Module + tokens
export { CurrencyModule } from './currency.module';
export * from './currency.tokens';
