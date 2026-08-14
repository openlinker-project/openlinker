/**
 * Exchange Rate Provider Port
 *
 * The contract every reference-rate publisher implements. Deliberately NOT a
 * capability port: a published reference rate is a shared read of a public
 * source, not a per-connection capability, so there is no adapter manifest
 * entry and no `getCapabilityAdapter` path. Implementations live in
 * `@openlinker/integrations-fx`; nothing under `libs/core` speaks HTTP.
 *
 * @module libs/core/src/currency/domain/ports
 */
import type {
  ExchangeRate,
  ExchangeRateSource,
  FetchRateInput,
} from '../types/exchange-rate.types';

export interface ExchangeRateProviderPort {
  /** The source key this provider answers for. Unique across the registry. */
  readonly name: ExchangeRateSource;

  /**
   * The single currency this source quotes everything against (NBP: `PLN`,
   * ECB: `EUR`), or `null` for a source with no single base. It is what a
   * `pivot` derivation divides through.
   */
  readonly pivotCurrency: string | null;

  /**
   * Whether this source can answer for the pair at all - a pure, static
   * predicate over its published currency list, with no I/O.
   *
   * This exists so an unsupported pair fails on the FIRST call rather than
   * after a full walk-back. `SyncJob.maxAttempts` defaults to 10, so without
   * it one unsupported pair costs 10 x 7 futile HTTP requests before dying.
   * A same-currency pair is NOT supported by any provider - no source
   * publishes an identity quote, and the stamp short-circuits before reaching
   * one.
   */
  supports(from: string, to: string): boolean;

  /**
   * Every currency this source quotes, including its own base. Pure, static,
   * no I/O - consumed by save-time reporting-currency validation, which must
   * not depend on a provider being reachable.
   */
  listSupportedCurrencies(): readonly string[];

  /**
   * Resolve the pair as of the CANDIDATE calendar day in `input.on`.
   *
   * The adapter owns its source's publication calendar: the returned
   * `ExchangeRate.rateDate` is the day the source ACTUALLY published for, which
   * may precede `input.on`, and is what the registry keys the row under.
   *
   * @throws RateUnsupportedPairError terminal - the source will never answer
   * @throws RateUnavailableTransientError retryable - the source is unreachable
   */
  fetchRate(input: FetchRateInput): Promise<ExchangeRate>;
}
