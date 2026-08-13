/**
 * PrestaShop Tax-Rate Unknown Exception
 *
 * Thrown when a buyer-paid GROSS line price must be converted to the
 * tax-EXCLUDED value PrestaShop pins into `specific_prices`, but the
 * destination product's tax rate cannot be resolved because the shop's tax
 * configuration is incomplete (#2052). Refusing the order is the correct
 * outcome: pinning `net = gross` makes PrestaShop add its own VAT on top and
 * creates an order whose total exceeds what the buyer paid (#895 / ADR-014).
 *
 * Deliberately distinct from `PrestashopApiException`: this is not a failed
 * call. The reads succeeded and reported data that cannot be priced with, so a
 * retry re-reads the same incomplete record. `PrestashopRetryClassifierAdapter`
 * classifies this class as non-retryable for exactly that reason — a transport
 * failure of the same read stays a `PrestashopApiException` and keeps its
 * retries.
 *
 * `message` is operator-facing interface copy, not a log line:
 * `OrderSyncService` stores it verbatim in `syncStatus[].error` and the
 * frontend renders that string in three places with no translation layer. The
 * tightest is the orders-list Status sub-line, CSS-clipped to ~40 characters,
 * so the message LEADS with the product identity. Keep the leading clause
 * intact when editing — see `taxRateUnknownError` for the budget table.
 *
 * @module libs/integrations/prestashop/src/domain/exceptions
 */
export class PrestashopTaxRateUnknownException extends Error {
  constructor(
    message: string,
    public readonly externalProductId?: string | number,
    public readonly connectionId?: string
  ) {
    super(message);
    this.name = 'PrestashopTaxRateUnknownException';
    Error.captureStackTrace(this, this.constructor);
  }
}
