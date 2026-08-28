/**
 * PrestaShop OR Filter Ignored Exception
 *
 * Thrown when a `filter[<field>]=[a|b|c]` OR read answers a shape that filter
 * cannot have produced - a row for an id nobody asked for.
 *
 * The general form of `PrestashopPackFilterIgnoredException`, which says the
 * same thing about `stock_availables` specifically. It exists because the same
 * unapplied filter on a DIFFERENT collection produces a different, worse
 * failure: on `combinations` every returned row is dropped as unrequested and
 * every requested product is left holding an empty combinations array, which is
 * a positive claim that the product has no variants. Acting on that claim
 * stales every real variant of a whole page and zeroes their offers (#1689).
 *
 * Deterministic for a given shop and filter, so `PrestashopRetryClassifierAdapter`
 * treats it like the truncated read: a retry fails identically and an operator
 * has to look.
 *
 * @module libs/integrations/prestashop/src/domain/exceptions
 */
export class PrestashopOrFilterIgnoredException extends Error {
  constructor(
    public readonly connectionId: string,
    public readonly resource: string,
    public readonly field: string,
    public readonly requestedIds: readonly string[],
    detail: string
  ) {
    super(
      `PrestaShop ${resource} read on connection ${connectionId} answered a shape the ` +
        `filter[${field}]=[${requestedIds.join('|')}] OR filter cannot produce (${detail}). ` +
        `Refusing to treat the response as an answer about those ids.`
    );
    this.name = 'PrestashopOrFilterIgnoredException';
    Error.captureStackTrace(this, this.constructor);
  }
}
