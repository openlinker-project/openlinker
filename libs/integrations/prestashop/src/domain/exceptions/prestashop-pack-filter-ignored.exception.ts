/**
 * PrestaShop Pack Filter Ignored Exception
 *
 * Thrown when a pack's component stock read comes back in a shape the `[a|b|c]`
 * OR filter cannot have produced.
 *
 * That filter has no other call site in this package and is not exercised
 * against a live shop by any test, so if a PrestaShop version drops or misreads
 * the pipe, every component reads as absent, `derivePackAvailability` returns 0,
 * and the pack is published as 0 - stopping a live listing with nothing logged.
 * The two shapes checked are a response holding a product id nobody asked for
 * (the condition was dropped, so the whole collection came back) and a response
 * holding no row for any requested component (PrestaShop materialises a stock
 * row per product, so all-absent is a filter fault, not a shop with no stock).
 *
 * Deterministic for a given shop and filter, so
 * `PrestashopRetryClassifierAdapter` treats it like the truncated read: a retry
 * fails identically and an operator has to look.
 *
 * @module libs/integrations/prestashop/src/domain/exceptions
 */
export class PrestashopPackFilterIgnoredException extends Error {
  constructor(
    public readonly connectionId: string,
    public readonly componentProductIds: readonly string[],
    detail: string
  ) {
    super(
      `PrestaShop stock_availables read on connection ${connectionId} answered a shape the ` +
        `[${componentProductIds.join('|')}] OR filter cannot produce (${detail}). Refusing to derive ` +
        `a pack quantity from it.`
    );
    this.name = 'PrestashopPackFilterIgnoredException';
    Error.captureStackTrace(this, this.constructor);
  }
}
