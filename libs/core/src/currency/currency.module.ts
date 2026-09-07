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
 * It carries ONE lifecycle hook: `onApplicationBootstrap` refuses to finish boot
 * with an empty provider registry (#2135 review, finding 9). See the method for
 * why the assertion belongs to core rather than to `FxIntegrationModule`.
 *
 * @module libs/core/src/currency
 */
import { Inject, Module, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Logger } from '@openlinker/shared/logging';
import {
  CURRENCY_RATE_SERVICE_TOKEN,
  EXCHANGE_RATE_LOOKUP_SERVICE_TOKEN,
  EXCHANGE_RATE_PROVIDER_REGISTRY_TOKEN,
  EXCHANGE_RATE_REPOSITORY_TOKEN,
  REPORTING_CURRENCY_SETTING_REPOSITORY_TOKEN,
  REPORTING_CURRENCY_SETTINGS_SERVICE_TOKEN,
} from './currency.tokens';
import { NoExchangeRateProvidersRegisteredError } from './domain/exceptions/exchange-rate-source.exception';
import { ExchangeRateProviderRegistryPort } from './domain/ports/exchange-rate-provider-registry.port';
import { CurrencyRateService } from './application/services/currency-rate.service';
import { ExchangeRateLookupService } from './application/services/exchange-rate-lookup.service';
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
    ExchangeRateLookupService,
    { provide: EXCHANGE_RATE_LOOKUP_SERVICE_TOKEN, useExisting: ExchangeRateLookupService },
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
    EXCHANGE_RATE_LOOKUP_SERVICE_TOKEN,
    REPORTING_CURRENCY_SETTINGS_SERVICE_TOKEN,
  ],
})
export class CurrencyModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(CurrencyModule.name);

  constructor(
    @Inject(EXCHANGE_RATE_PROVIDER_REGISTRY_TOKEN)
    private readonly registry: ExchangeRateProviderRegistryPort
  ) {}

  /**
   * Fail the boot when nothing registered a provider (#2135 review, finding 9).
   *
   * `onApplicationBootstrap`, not `onModuleInit`: Nest runs EVERY module's
   * `onModuleInit` before the first bootstrap hook, so this is the earliest point
   * at which "the registry is still empty" means "no module will ever fill it"
   * rather than "FxIntegrationModule has not run yet".
   *
   * It lives on the CORE module on purpose. The check has to hold for any host
   * that consumes the currency context, and a host missing
   * `FxIntegrationModule` is precisely the case that cannot assert anything from
   * inside that module. Core still learns nothing about which providers exist -
   * only that the count is not zero.
   */
  onApplicationBootstrap(): void {
    const registered = this.registry.list();
    if (registered.length === 0) {
      throw new NoExchangeRateProvidersRegisteredError();
    }
    this.logger.log(
      `Exchange-rate providers registered: ${registered.map((p) => p.name).join(', ')}`
    );
  }
}
