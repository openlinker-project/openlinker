/**
 * Fake Exchange Rate Adapter
 *
 * Deterministic, offline provider for tests and local development - the FX
 * counterpart to `FakeAiCompletionAdapter`. The integration suite registers one
 * of these into the REAL `ExchangeRateProviderRegistryService` rather than
 * mocking the port, so the registration seam the host wiring depends on is
 * exercised rather than stubbed out, and no tier ever makes a live NBP or ECB
 * call.
 *
 * It is deliberately NOT registered by `FxIntegrationModule`: a fake that
 * shipped in the DI graph would be one misconfiguration away from stamping
 * invented rates onto real orders.
 *
 * @module libs/integrations/fx/infrastructure/adapters
 */
import {
  RateUnsupportedPairError,
  type ExchangeRate,
  type ExchangeRateProviderPort,
  type ExchangeRateSource,
  type FetchRateInput,
} from '@openlinker/core/currency';

export interface FakeExchangeRateAdapterOptions {
  /** Which source this fake stands in for. */
  readonly name: ExchangeRateSource;
  readonly pivotCurrency?: string | null;
  readonly supportedCurrencies?: readonly string[];
  /** `from/to` keyed rates, e.g. `{ 'EUR/PLN': '4.25000000' }`. */
  readonly rates?: Readonly<Record<string, string>>;
}

export class FakeExchangeRateAdapter implements ExchangeRateProviderPort {
  readonly name: ExchangeRateSource;
  readonly pivotCurrency: string | null;

  private readonly supportedCurrencies: readonly string[];
  /**
   * The seed this instance was constructed with, kept so `reset()` can restore
   * it. Held separately from `rates` because `setRate` mutates the live map.
   */
  private readonly seededRates: Readonly<Record<string, string>>;
  private rates: Record<string, string>;
  /** Call count, so a spec can assert the registry absorbed a repeat lookup. */
  private fetchCount = 0;

  constructor(options: FakeExchangeRateAdapterOptions) {
    this.name = options.name;
    this.pivotCurrency = options.pivotCurrency ?? null;
    this.supportedCurrencies = options.supportedCurrencies ?? ['PLN', 'EUR', 'USD', 'GBP'];
    this.seededRates = { ...(options.rates ?? { 'EUR/PLN': '4.25000000', 'PLN/EUR': '0.23529412' }) };
    this.rates = { ...this.seededRates };
  }

  supports(from: string, to: string): boolean {
    if (from === to) {
      return false;
    }
    return this.supportedCurrencies.includes(from) && this.supportedCurrencies.includes(to);
  }

  listSupportedCurrencies(): readonly string[] {
    return this.supportedCurrencies;
  }

  fetchRate(input: FetchRateInput): Promise<ExchangeRate> {
    this.fetchCount += 1;
    const rate = this.rates[`${input.from}/${input.to}`];

    if (rate === undefined) {
      return Promise.reject(
        new RateUnsupportedPairError(
          this.name,
          input.from,
          input.to,
          input.on,
          'the fake provider was not seeded with this pair'
        )
      );
    }

    return Promise.resolve({
      source: this.name,
      from: input.from,
      to: input.to,
      // Answers with the candidate day verbatim - a fake has no publication
      // calendar to resolve against, and a spec that wants a walk-back should
      // exercise a real adapter with a faked `FetchLike`.
      rateDate: input.on,
      rate,
      sourceRef: `fake:${this.name}`,
      pivotCurrency: null,
      derivation: {
        kind: 'direct',
        legs: [{ pair: `${input.from}/${input.to}`, ref: `fake:${this.name}`, effectiveDate: input.on }],
      },
    });
  }

  /** Identity - test determinism for existing specs is unaffected (#2777). */
  resolveExpectedPublicationDay(candidate: string): string {
    return candidate;
  }

  /** Seed or replace a pair. */
  setRate(from: string, to: string, rate: string): void {
    this.rates[`${from}/${to}`] = rate;
  }

  /** How many times a rate was actually fetched since construction. */
  getFetchCount(): number {
    return this.fetchCount;
  }

  /**
   * Back to the constructed state - the CONSTRUCTOR'S SEED, not an empty map.
   * Emptying it would make a `reset()` between cases silently turn every
   * lookup into a `RateUnsupportedPairError`, which is the opposite of what a
   * fake documenting itself as deterministic should do.
   */
  reset(): void {
    this.rates = { ...this.seededRates };
    this.fetchCount = 0;
  }
}
