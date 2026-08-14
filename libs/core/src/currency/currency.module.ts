/**
 * Currency Module (core)
 *
 * NestJS module for the currency bounded context - a LEAF: it imports no
 * sibling core context and speaks no HTTP. Every provider that does speak HTTP
 * ships in `@openlinker/integrations-fx` and registers itself into this
 * module's `ExchangeRateProviderRegistryService` at boot.
 *
 * IT IS A STATIC `@Module` AND MUST STAY ONE - never `forRoot`. A dynamic
 * module would hand core and `FxIntegrationModule` two different registry
 * instances, so the adapters would register into a registry nothing reads.
 * This is the same reason `AdapterRegistryService` works today.
 *
 * `TypeOrmModule.forFeature([...])` is mandatory, not decorative: runtime
 * entity discovery is `autoLoadEntities: true`, so without it neither table
 * materialises in the `synchronize`-built dev/test schema.
 *
 * @module libs/core/src/currency
 */
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  CURRENCY_RATE_SERVICE_TOKEN,
  EXCHANGE_RATE_PROVIDER_REGISTRY_TOKEN,
  EXCHANGE_RATE_REPOSITORY_TOKEN,
  REPORTING_CURRENCY_SETTING_REPOSITORY_TOKEN,
  REPORTING_CURRENCY_SETTINGS_SERVICE_TOKEN,
} from './currency.tokens';
import { CurrencyRateService } from './application/services/currency-rate.service';
import { ReportingCurrencySettingsService } from './application/services/reporting-currency-settings.service';
import { ExchangeRateProviderRegistryService } from './infrastructure/adapters/exchange-rate-provider-registry.service';
import { ExchangeRateOrmEntity } from './infrastructure/persistence/entities/exchange-rate.orm-entity';
import { ReportingCurrencySettingOrmEntity } from './infrastructure/persistence/entities/reporting-currency-setting.orm-entity';
import { ExchangeRateRepository } from './infrastructure/persistence/repositories/exchange-rate.repository';
import { ReportingCurrencySettingRepository } from './infrastructure/persistence/repositories/reporting-currency-setting.repository';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([ExchangeRateOrmEntity, ReportingCurrencySettingOrmEntity]),
  ],
  providers: [
    ExchangeRateProviderRegistryService,
    {
      provide: EXCHANGE_RATE_PROVIDER_REGISTRY_TOKEN,
      useExisting: ExchangeRateProviderRegistryService,
    },
    ExchangeRateRepository,
    { provide: EXCHANGE_RATE_REPOSITORY_TOKEN, useExisting: ExchangeRateRepository },
    ReportingCurrencySettingRepository,
    {
      provide: REPORTING_CURRENCY_SETTING_REPOSITORY_TOKEN,
      useExisting: ReportingCurrencySettingRepository,
    },
    CurrencyRateService,
    { provide: CURRENCY_RATE_SERVICE_TOKEN, useExisting: CurrencyRateService },
    ReportingCurrencySettingsService,
    {
      provide: REPORTING_CURRENCY_SETTINGS_SERVICE_TOKEN,
      useExisting: ReportingCurrencySettingsService,
    },
  ],
  exports: [
    // Exported so `FxIntegrationModule` can inject it and register its adapters.
    EXCHANGE_RATE_PROVIDER_REGISTRY_TOKEN,
    EXCHANGE_RATE_REPOSITORY_TOKEN,
    REPORTING_CURRENCY_SETTING_REPOSITORY_TOKEN,
    CURRENCY_RATE_SERVICE_TOKEN,
    REPORTING_CURRENCY_SETTINGS_SERVICE_TOKEN,
  ],
})
export class CurrencyModule {}
