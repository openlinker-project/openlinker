/**
 * Exchange Rate Provider Registry Service
 *
 * In-memory registry of reference-rate providers, empty on construct and
 * populated at boot by `FxIntegrationModule.onModuleInit` - byte-for-byte the
 * mechanism integration modules already use for `AdapterRegistryService`
 * (#570/#571). Keeping it empty on construct is what lets `libs/core` stay
 * ignorant of which providers exist.
 *
 * It implements a domain `*Port`, which satisfies the service-interface
 * invariant without a parallel `I*Service` - the same posture
 * `AdapterRegistryService` has.
 *
 * @module libs/core/src/currency/infrastructure/adapters
 * @implements {ExchangeRateProviderRegistryPort}
 */
import { Injectable } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import {
  DuplicateExchangeRateSourceError,
  UnregisteredExchangeRateSourceError,
} from '../../domain/exceptions/exchange-rate-source.exception';
import type { ExchangeRateProviderPort } from '../../domain/ports/exchange-rate-provider.port';
import type { ExchangeRateProviderRegistryPort } from '../../domain/ports/exchange-rate-provider-registry.port';
import type { ExchangeRateSource } from '../../domain/types/exchange-rate.types';

@Injectable()
export class ExchangeRateProviderRegistryService implements ExchangeRateProviderRegistryPort {
  private readonly logger = new Logger(ExchangeRateProviderRegistryService.name);
  private readonly providers = new Map<ExchangeRateSource, ExchangeRateProviderPort>();

  register(provider: ExchangeRateProviderPort): void {
    if (this.providers.has(provider.name)) {
      throw new DuplicateExchangeRateSourceError(provider.name);
    }
    this.providers.set(provider.name, provider);
    this.logger.log(`Registered exchange-rate provider: ${provider.name}`);
  }

  get(source: ExchangeRateSource): ExchangeRateProviderPort {
    const provider = this.providers.get(source);
    if (!provider) {
      // Terminal, never transient: no retry makes a module appear in the DI
      // graph, and retrying would only delay the operator seeing that the host
      // is missing `FxIntegrationModule`.
      throw new UnregisteredExchangeRateSourceError(source, Array.from(this.providers.keys()));
    }
    return provider;
  }

  has(source: ExchangeRateSource): boolean {
    return this.providers.has(source);
  }

  list(): readonly ExchangeRateProviderPort[] {
    return Array.from(this.providers.values());
  }
}
