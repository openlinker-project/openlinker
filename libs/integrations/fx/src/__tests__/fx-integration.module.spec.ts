/**
 * FX Integration Module Tests
 *
 * Exercises the registration seam - the whole reason this package exists as a
 * separate module, since it is how the binding crosses from an integration
 * package into core without core ever importing it.
 *
 * The registry here is a local double rather than the concrete core service:
 * `ExchangeRateProviderRegistryService` is intentionally NOT on the
 * `@openlinker/core/currency` barrel (a sibling package sees the registry
 * through its port, exactly as it sees `AdapterRegistryService`). The concrete
 * registry's own behaviour - duplicate rejection, terminal unknown-source error
 * - is pinned in its own spec in core.
 *
 * @module libs/integrations/fx/__tests__
 */
import {
  DuplicateExchangeRateSourceError,
  type ExchangeRateProviderPort,
  type ExchangeRateProviderRegistryPort,
  type ExchangeRateSource,
} from '@openlinker/core/currency';
import type { FetchLike } from '@openlinker/shared/http';
import { FxIntegrationModule } from '../fx-integration.module';
import { EcbExchangeRateAdapter } from '../infrastructure/adapters/ecb-exchange-rate.adapter';
import { NbpExchangeRateAdapter } from '../infrastructure/adapters/nbp-exchange-rate.adapter';

const neverCalled = (() =>
  Promise.reject(new Error('no HTTP in this spec'))) as unknown as FetchLike;

/** Mirrors the core registry's contract, including its duplicate rejection. */
class RecordingRegistry implements ExchangeRateProviderRegistryPort {
  private readonly providers = new Map<ExchangeRateSource, ExchangeRateProviderPort>();

  register(provider: ExchangeRateProviderPort): void {
    if (this.providers.has(provider.name)) {
      throw new DuplicateExchangeRateSourceError(provider.name);
    }
    this.providers.set(provider.name, provider);
  }

  get(source: ExchangeRateSource): ExchangeRateProviderPort {
    const provider = this.providers.get(source);
    if (!provider) {
      throw new Error(`not registered: ${source}`);
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

describe('FxIntegrationModule', () => {
  let registry: RecordingRegistry;
  let nbp: NbpExchangeRateAdapter;
  let ecb: EcbExchangeRateAdapter;

  beforeEach(() => {
    registry = new RecordingRegistry();
    nbp = new NbpExchangeRateAdapter({ fetchImpl: neverCalled });
    ecb = new EcbExchangeRateAdapter({ fetchImpl: neverCalled });
  });

  it('should register BOTH providers on module init', () => {
    // Which one a deployment reads follows from its reporting currency, not
    // from which module happened to be wired in - so both always register.
    new FxIntegrationModule(registry, nbp, ecb).onModuleInit();

    expect(registry.has('nbp')).toBe(true);
    expect(registry.has('ecb')).toBe(true);
    expect(registry.list()).toHaveLength(2);
  });

  it('should register each adapter under its own source name', () => {
    new FxIntegrationModule(registry, nbp, ecb).onModuleInit();

    expect(registry.get('nbp')).toBe(nbp);
    expect(registry.get('ecb')).toBe(ecb);
  });

  it('should let a double init surface loudly rather than silently shadowing', () => {
    const module = new FxIntegrationModule(registry, nbp, ecb);
    module.onModuleInit();

    expect(() => module.onModuleInit()).toThrow(DuplicateExchangeRateSourceError);
  });

  it('should expose the pivot currency each source quotes against', () => {
    new FxIntegrationModule(registry, nbp, ecb).onModuleInit();

    expect(registry.get('nbp').pivotCurrency).toBe('PLN');
    expect(registry.get('ecb').pivotCurrency).toBe('EUR');
  });

  it('should cover both shipped reporting currencies between them', () => {
    // The save-time reachability gate is the union of the registered providers'
    // supported sets, so this is the wiring half of that guarantee.
    new FxIntegrationModule(registry, nbp, ecb).onModuleInit();

    const quoted = new Set(
      registry.list().flatMap((provider) => [...provider.listSupportedCurrencies()])
    );

    expect(quoted.has('PLN')).toBe(true);
    expect(quoted.has('EUR')).toBe(true);
  });

  it('should make no HTTP call at boot', async () => {
    // Registration is pure wiring: a provider that probed its source on init
    // would make host boot depend on a third party being up.
    expect(() => new FxIntegrationModule(registry, nbp, ecb).onModuleInit()).not.toThrow();
    await Promise.resolve();
  });
});
