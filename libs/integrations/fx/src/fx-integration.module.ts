/**
 * FX Integration Module
 *
 * Registers the reference-rate provider adapters into the core
 * `ExchangeRateProviderRegistryService` at boot - byte-for-byte the mechanism
 * integration modules already use to populate `AdapterRegistryService`
 * (#570/#571). Nothing in `libs/core` imports this package; the binding
 * crosses at the host, which is what keeps the dependency direction intact.
 *
 * IT IS NOT A PLUGIN. There is no adapter manifest, no
 * `adapterRegistry.register`, and no `createCapabilityAdapter`: a published
 * reference rate is a shared read of a public source, not a per-connection
 * capability, so no `getCapabilityAdapter` path exists. It appears in
 * `apiPlugins` / `workerPlugins` purely as a module-composition seam, exactly
 * as `AiIntegrationModule` does (`PluginRegistryModule.forRoot` only does
 * `imports` + `exports`).
 *
 * BOTH HOSTS register it. Order ingestion and the FX retry / sweep handlers are
 * worker-side, so the worker is the load-bearing one; the API is registered too
 * so a future API-side restamp endpoint fails at boot rather than at runtime
 * against an empty registry.
 *
 * @module libs/integrations/fx
 */
import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import {
  CurrencyModule,
  EXCHANGE_RATE_PROVIDER_REGISTRY_TOKEN,
  type ExchangeRateProviderPort,
  type ExchangeRateProviderRegistryPort,
} from '@openlinker/core/currency';
import type { FetchLike } from '@openlinker/shared/http';
import {
  ECB_EXCHANGE_RATE_ADAPTER_TOKEN,
  FX_FETCH_TOKEN,
  FX_TIMEOUT_MS_TOKEN,
  NBP_EXCHANGE_RATE_ADAPTER_TOKEN,
} from './fx-integration.tokens';
import { EcbExchangeRateAdapter } from './infrastructure/adapters/ecb-exchange-rate.adapter';
import { NbpExchangeRateAdapter } from './infrastructure/adapters/nbp-exchange-rate.adapter';
import { FX_DEFAULT_TIMEOUT_MS } from './infrastructure/http/fx-http.client';

@Module({
  imports: [CurrencyModule],
  providers: [
    {
      provide: FX_FETCH_TOKEN,
      useFactory: (): FetchLike =>
        // eslint-disable-next-line no-restricted-globals -- The connection-bound transport (HostServices.http / HttpTransportFactoryPort) keys its cache and its rate-limit bucket on connection.id, and a public reference-rate read has no connection; a synthetic one would create a bucket that means nothing. This is the SINGLE global-transport reference in the package - both adapters take the injected FetchLike, which is also what makes their specs fakeable without jest.spyOn(globalThis).
        (input, init) => fetch(input, init),
    },
    {
      provide: FX_TIMEOUT_MS_TOKEN,
      useValue: FX_DEFAULT_TIMEOUT_MS,
    },
    {
      provide: NBP_EXCHANGE_RATE_ADAPTER_TOKEN,
      useFactory: (fetchImpl: FetchLike, timeoutMs: number): NbpExchangeRateAdapter =>
        new NbpExchangeRateAdapter({ fetchImpl, timeoutMs }),
      inject: [FX_FETCH_TOKEN, FX_TIMEOUT_MS_TOKEN],
    },
    {
      provide: ECB_EXCHANGE_RATE_ADAPTER_TOKEN,
      useFactory: (fetchImpl: FetchLike, timeoutMs: number): EcbExchangeRateAdapter =>
        new EcbExchangeRateAdapter({ fetchImpl, timeoutMs }),
      inject: [FX_FETCH_TOKEN, FX_TIMEOUT_MS_TOKEN],
    },
  ],
  exports: [NBP_EXCHANGE_RATE_ADAPTER_TOKEN, ECB_EXCHANGE_RATE_ADAPTER_TOKEN],
})
export class FxIntegrationModule implements OnModuleInit {
  constructor(
    @Inject(EXCHANGE_RATE_PROVIDER_REGISTRY_TOKEN)
    private readonly registry: ExchangeRateProviderRegistryPort,
    @Inject(NBP_EXCHANGE_RATE_ADAPTER_TOKEN)
    private readonly nbp: ExchangeRateProviderPort,
    @Inject(ECB_EXCHANGE_RATE_ADAPTER_TOKEN)
    private readonly ecb: ExchangeRateProviderPort
  ) {}

  onModuleInit(): void {
    // Both providers, always, and together: which one a deployment actually
    // reads follows from its reporting currency (`resolveRateSource`), not from
    // which module happened to be wired in.
    this.registry.register(this.nbp);
    this.registry.register(this.ecb);
  }
}
