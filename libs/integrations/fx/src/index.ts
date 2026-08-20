/**
 * FX Integration Package - Public Surface
 *
 * Exports the NestJS module plus the concrete provider adapters. Consumers read
 * rates through `ICurrencyRateService` (`@openlinker/core/currency`), never
 * through an adapter class directly - the registry is the seam, and which
 * provider serves a deployment follows from its reporting currency.
 *
 * @module libs/integrations/fx
 */
export { FxIntegrationModule } from './fx-integration.module';
export {
  ECB_EXCHANGE_RATE_ADAPTER_TOKEN,
  FX_FETCH_TOKEN,
  FX_TIMEOUT_MS_TOKEN,
  NBP_EXCHANGE_RATE_ADAPTER_TOKEN,
} from './fx-integration.tokens';
export {
  EcbExchangeRateAdapter,
  type EcbExchangeRateAdapterDeps,
} from './infrastructure/adapters/ecb-exchange-rate.adapter';
export {
  NbpExchangeRateAdapter,
  type NbpExchangeRateAdapterDeps,
} from './infrastructure/adapters/nbp-exchange-rate.adapter';
export {
  FakeExchangeRateAdapter,
  type FakeExchangeRateAdapterOptions,
} from './infrastructure/adapters/fake-exchange-rate.adapter';
export {
  FX_DEFAULT_TIMEOUT_MS,
  FxTransportError,
  fxGet,
  type FxHttpResponse,
} from './infrastructure/http/fx-http.client';
