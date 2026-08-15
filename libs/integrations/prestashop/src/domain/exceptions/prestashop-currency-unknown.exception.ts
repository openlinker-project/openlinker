/**
 * PrestaShop Currency Unknown Exception
 *
 * Thrown when the destination PrestaShop currency for an order cannot be
 * determined (#2139): the source order carries no currency code, the shop has
 * no currency row for the order's ISO 4217 code, or the matching row carries an
 * id PrestaShop cannot be addressed with. Refusing the order is the correct
 * outcome: line amounts are the buyer-paid source numerals (#895 / ADR-014), so
 * booking them under a substituted currency produces an order with the right
 * numbers under the wrong denomination, and the `conversion_rate`
 * `PaymentModule::validateOrder` stamps from that currency then relates the
 * header to the shop default at the wrong factor. Invoicing and analytics
 * inherit the wrong denomination downstream, and the sync still reports success.
 *
 * Deliberately distinct from `PrestashopApiException`: this is not a failed
 * call. Either there was nothing to read (an order with no currency), or the
 * read SUCCEEDED and reported data the order cannot be denominated with, so a
 * retry re-reads the same record. `PrestashopRetryClassifierAdapter` classifies
 * this class as non-retryable for exactly that reason - a transport failure of
 * the same `GET /currencies` read stays a `PrestashopApiException`. The class IS
 * the retry decision; the two must never be conflated. (On the order-create path
 * as shipped, neither reaches the runner - see the note in
 * `PrestashopRetryClassifierAdapter` - so the split is correct-by-construction
 * rather than currently load-bearing.)
 *
 * `message` is operator-facing interface copy, not a log line: `OrderSyncService`
 * stores it verbatim in `syncStatus[].error` and the frontend renders that string
 * with no translation layer, the tightest surface being the orders-list Status
 * sub-line clipped to ~40 characters. The message therefore LEADS with the
 * identity (the currency code, or the order when there is no code at all), then
 * states the cause, then the action. Keep the leading clause intact when editing.
 *
 * @module libs/integrations/prestashop/src/domain/exceptions
 */
export class PrestashopCurrencyUnknownException extends Error {
  constructor(
    message: string,
    /** ISO 4217 code that could not be resolved, when the order carried one. */
    public readonly isoCode?: string,
    public readonly connectionId?: string
  ) {
    super(message);
    this.name = 'PrestashopCurrencyUnknownException';
    Error.captureStackTrace(this, this.constructor);
  }
}
