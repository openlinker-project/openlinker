/**
 * Exchange Rate Domain Exceptions
 *
 * The rate-lookup failure taxonomy. The split is load-bearing rather than
 * cosmetic: `SyncJob.maxAttempts` defaults to 10, so misclassifying a
 * permanent condition as retryable costs ten futile provider round-trips per
 * order and then dies anyway, while misclassifying a blip as terminal loses a
 * stamp that would have succeeded a minute later. Per ADR-007 a terminal
 * condition is a `business_failure`, not a retry.
 *
 * @module libs/core/src/currency/domain/exceptions
 */

/**
 * The source could not be reached, or answered in a way that says nothing
 * about the pair itself - a 5xx, a network failure, a timeout. RETRYABLE.
 */
export class RateUnavailableTransientError extends Error {
  constructor(
    public readonly source: string,
    public readonly from: string,
    public readonly to: string,
    public readonly rateDate: string,
    public readonly reason: string
  ) {
    super(
      `Exchange rate ${from}/${to} on ${rateDate} is temporarily unavailable from '${source}': ${reason}`
    );
    this.name = 'RateUnavailableTransientError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * The source cannot answer for this pair, and will not on a retry - the pair
 * is absent from the source's table, the walk-back was exhausted, the source
 * answered a non-404 4xx (our request is wrong), or a pivot's two legs
 * disagreed on their effective date. TERMINAL: no stamp, no retry job.
 */
export class RateUnsupportedPairError extends Error {
  constructor(
    public readonly source: string,
    public readonly from: string,
    public readonly to: string,
    public readonly rateDate: string,
    public readonly reason: string
  ) {
    super(
      `Exchange rate ${from}/${to} on ${rateDate} is not obtainable from '${source}': ${reason}`
    );
    this.name = 'RateUnsupportedPairError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * A row for this `(source, from, to, rateDate)` already exists. The domain
 * translation of PostgreSQL `23505`; the caller re-selects the winner rather
 * than propagating, which is the insert-then-recover get-or-create the repo
 * already uses for identifier mappings.
 */
export class DuplicateExchangeRateError extends Error {
  constructor(
    public readonly source: string,
    public readonly from: string,
    public readonly to: string,
    public readonly rateDate: string
  ) {
    super(`Exchange rate already registered: ${source} ${from}/${to} on ${rateDate}`);
    this.name = 'DuplicateExchangeRateError';
    Error.captureStackTrace(this, this.constructor);
  }
}
