/**
 * PrestaShop Conversion-Rate Unknown Exception
 *
 * Thrown when an outbound PrestaShop order body needs the `conversion_rate`
 * that relates the order's currency to the shop's DEFAULT currency, but the
 * shop's currency configuration cannot state it (#2102). Refusing the order is
 * the correct outcome: writing `1.000000` tells PrestaShop the two currencies
 * are at parity, so a EUR order is booked with its numerals treated as the
 * shop's default. That is worse than a flat mis-conversion, because the order
 * LINES are pinned separately at the buyer-paid source price via cart-scoped
 * `specific_prices` (#895 / ADR-014) - the header would be recomputed at the
 * bogus rate while the lines carry the pinned amounts, and the two disagree on
 * the same document.
 *
 * Deliberately distinct from `PrestashopApiException`, mirroring
 * `PrestashopTaxRateUnknownException` (#2052): this is not a failed call. The
 * reads succeeded and reported data the rate cannot be derived from, so a retry
 * re-reads the same record. `PrestashopRetryClassifierAdapter` classifies this
 * class as non-retryable for exactly that reason - a transport failure of the
 * same read stays a `PrestashopApiException` and keeps its retries.
 *
 * `message` is operator-facing interface copy, not a log line:
 * `OrderSyncService` stores it verbatim in `syncStatus[].error` and the frontend
 * renders that string with no translation layer, the tightest surface being the
 * orders-list Status sub-line (CSS-clipped to ~40 characters). So the message
 * LEADS with the currency pair that cannot be converted.
 *
 * @module libs/integrations/prestashop/src/domain/exceptions
 */
export class PrestashopConversionRateUnknownException extends Error {
  constructor(
    message: string,
    public readonly currencyIso?: string,
    public readonly connectionId?: string
  ) {
    super(message);
    this.name = 'PrestashopConversionRateUnknownException';
    Error.captureStackTrace(this, this.constructor);
  }
}
