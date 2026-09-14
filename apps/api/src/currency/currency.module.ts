/**
 * Currency API Module
 *
 * Mounts the HTTP surface for the currency bounded context. Follows the
 * `{domain}.module.ts` + `{Domain}ApiModule` pattern `AiApiModule` /
 * `AnalyticsApiModule` already use: it owns no providers, only controllers, and
 * imports the two core modules whose tokens the controller injects.
 *
 * `OrdersModule` is imported for `ORDER_FX_READ_SERVICE_TOKEN` - the coverage
 * advisory and the era-split counts are composed in the controller, which is the
 * only layer allowed to combine the two contexts.
 *
 * @module apps/api/src/currency
 */
import { Module } from '@nestjs/common';
import { CurrencyModule as CoreCurrencyModule } from '@openlinker/core/currency';
import { OrdersModule } from '@openlinker/core/orders';
import { CurrencySettingsController } from './http/currency-settings.controller';
import { ExchangeRatesController } from './http/exchange-rates.controller';

@Module({
  imports: [CoreCurrencyModule, OrdersModule],
  controllers: [CurrencySettingsController, ExchangeRatesController],
})
export class CurrencyApiModule {}
