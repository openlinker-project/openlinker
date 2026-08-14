/**
 * Exchange Rate Types
 *
 * The neutral shape of a published reference rate, the key it is registered
 * under, and the derivation record that keeps a non-published (inverted or
 * pivoted) figure auditable.
 *
 * DIRECTION IS AN INVARIANT, NOT A CONVENTION: `rate` is the number of `to`
 * units per one `from` unit, so a consumer always MULTIPLIES. Getting it
 * backwards produces a plausible number, never throws, and is wrong by the
 * square of the rate.
 *
 * Note the deliberate naming split with `ReportingCurrencySource`
 * (`reporting-currency.types.ts`): `ExchangeRateSource` is WHICH PUBLISHER a
 * rate came from, while `ReportingCurrencySource` is the PROVENANCE of the
 * resolved reporting-currency setting (row / env / default). Two `*Source`
 * types in one context is a review trap - they are unrelated.
 *
 * @module libs/core/src/currency/domain/types
 */

/**
 * Reference-rate publishers OpenLinker can read.
 *
 * Open at the edges by intent: adding a third is a new adapter in
 * `@openlinker/integrations-fx` plus one entry here and one in
 * `SOURCE_BY_REPORTING_CURRENCY`.
 */
export const EXCHANGE_RATE_SOURCES = ['nbp', 'ecb'] as const;

export type ExchangeRateSource = (typeof EXCHANGE_RATE_SOURCES)[number];

/** Runtime narrowing for a value read back out of the database. */
export function isExchangeRateSource(value: string): value is ExchangeRateSource {
  return (EXCHANGE_RATE_SOURCES as readonly string[]).includes(value);
}

/**
 * How a stored rate was obtained from the source's own published quotes.
 *
 * - `direct` - the source publishes this exact pair.
 * - `inverted` - the source publishes the reciprocal pair; `rate = 1 / mid`.
 * - `pivot` - neither side is the source's base, so two published quotes are
 *   divided through that base.
 */
export const RATE_DERIVATION_KINDS = ['direct', 'inverted', 'pivot'] as const;

export type RateDerivationKind = (typeof RATE_DERIVATION_KINDS)[number];

/**
 * One published quote that fed a derivation.
 *
 * `ref` is the source's own document reference where it has one (NBP's table
 * number, e.g. `149/A/NBP/2026`). ECB assigns no such identifier - its
 * `header.id` is a fresh random UUID per request and `Last-Modified` is not
 * data-dependent - so the ECB adapter records an OpenLinker-constructed,
 * re-executable locator (`ECB:EXR(1.0):D.PLN.EUR.SP00.A@{TIME_PERIOD}`)
 * instead. That distinction is deliberate and stated rather than papered over.
 */
export interface RateDerivationLeg {
  /** The published pair, e.g. `EUR/PLN`. */
  readonly pair: string;
  /** The source's document reference, or the OL-constructed locator. */
  readonly ref: string | null;
  /** The day the leg's quote is published for, ISO `YYYY-MM-DD`. */
  readonly effectiveDate: string;
}

/**
 * The audit trail for a stored rate. `NOT NULL` on the column by design - a
 * direct rate records `{"kind":"direct","legs":[{...}]}` so the field is never
 * a "sometimes populated" one a consumer has to guess about.
 */
export interface RateDerivation {
  readonly kind: RateDerivationKind;
  readonly legs: readonly RateDerivationLeg[];
}

/**
 * A reference rate as the registry stores it.
 *
 * `rate` is a STRING and stays one end to end: it is written to a
 * `numeric(18,8)` column, and the repo has zero `transformer:` usages, so
 * `Number()`-ing it in `toDomain` (which every other money column does) would
 * silently reintroduce binary-float error into the audited figure.
 */
export interface ExchangeRate {
  readonly source: ExchangeRateSource;
  /** ISO-4217, the unit being priced. */
  readonly from: string;
  /** ISO-4217, the unit the price is expressed in. */
  readonly to: string;
  /** The day the rate is published for, ISO `YYYY-MM-DD`. */
  readonly rateDate: string;
  /** `to` units per one `from` unit, 8 decimal places. */
  readonly rate: string;
  readonly sourceRef: string | null;
  /** The base a `pivot` derivation divided through; `null` otherwise. */
  readonly pivotCurrency: string | null;
  readonly derivation: RateDerivation;
}

/** A rate that has been persisted, so it carries a registry id. */
export interface StoredExchangeRate extends ExchangeRate {
  readonly id: string;
  readonly fetchedAt: Date;
}

/** The registry's natural key. */
export interface ExchangeRateKey {
  readonly source: ExchangeRateSource;
  readonly from: string;
  readonly to: string;
  readonly rateDate: string;
}

/**
 * Input to `ICurrencyRateService.getRateFor`.
 *
 * Both `rateDate` and `source` arrive ALREADY RESOLVED: the caller owns
 * `placedAt` and the resolved reporting currency, which is what keeps
 * `currency` a leaf context with no `orders` back-edge.
 */
export type GetRateInput = ExchangeRateKey;

/** What a provider adapter is asked for. */
export interface FetchRateInput {
  readonly from: string;
  readonly to: string;
  /**
   * The CALENDAR candidate day produced by `resolveRateDate`. Each adapter
   * resolves it onto a day its own source actually published on, and reports
   * that day back as `ExchangeRate.rateDate`.
   */
  readonly on: string;
}
