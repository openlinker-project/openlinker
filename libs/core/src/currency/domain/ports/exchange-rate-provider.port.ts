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

  /**
   * A day <= `candidate` such that no day in `(returned, candidate]` is a
   * publication day for this source. Pure, synchronous, no I/O.
   *
   * Optional (ADR-046 probe-not-trust pattern - see
   * `description-format-resolution.ts` for the precedent): an adapter that
   * declares nothing keeps the pre-#2777 behaviour, where the cache read is
   * keyed on the candidate itself.
   *
   * THE TWO WAYS TO BE WRONG ARE NOT SYMMETRIC, and an implementer must know
   * which direction is safe to guess in.
   *
   * Returning a day that is TOO LATE - later than the true nearest
   * publication day - can only ever cause a cache *miss*: no row exists
   * under that later day (nothing writes one there), so the read falls
   * through to the existing `fetchRate` path unchanged. Free, and never a
   * wrong stamp.
   *
   * Returning a day that is TOO EARLY - walking back PAST a genuine
   * publication day `X` to an earlier day `Y` - corrupts a stamp. A row
   * under `Y` very likely already exists (written by some other candidate
   * that legitimately resolved there), so the read *hits*, and `getRateFor`
   * returns day-`Y`'s rate where `fetchRate` would have returned day-`X`'s -
   * silently, with no error anywhere, on a financial figure. The contract's
   * guarantee ("no publication day lies between the returned day and the
   * candidate") is exactly what a too-early answer violates, and only a
   * too-early answer can violate it.
   *
   * So: when in doubt about whether a day is a publication day, RETURN THE
   * CANDIDATE UNCHANGED. Erring late costs one avoidable cache miss; erring
   * early is unrecoverable. Neither shipped adapter can produce a too-early
   * answer today - ECB only ever skips a weekend, and NBP's calendar is the
   * same one that already decides which day NBP is asked for, so it errs
   * optimistic (the safe direction) rather than walking back past a day it
   * is not certain about.
   */
  resolveExpectedPublicationDay?(candidate: string): string;
}
