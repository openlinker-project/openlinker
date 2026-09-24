/**
 * Subiekt Net-Priced Order Exception
 *
 * Raised when an order whose source reports NET (tax-exclusive) line prices is
 * routed to Subiekt. The ZK is created with `LiczonyOdCenBrutto = true` and the
 * per-line amounts are written to `WartoscBruttoPrzedRabatem`/`PoRabacie`, so a
 * net figure written there is read by Subiekt as a gross one and the order is
 * booked roughly one VAT rate below what the buyer actually paid — silently,
 * with every total internally consistent.
 *
 * It REFUSES rather than converting. OpenLinker never computes or infers tax to
 * turn net into gross for a fiscal document (ADR-026, and the same rule core's
 * own `describeNetPricedOrderRefusal` enforces on the invoice path); a ZK is the
 * document the invoice is later derived from, so letting it through here would
 * simply move the same error one document downstream. The invoice path already
 * refuses such an order, so without this guard the order would book a wrong ZK
 * and then never produce the document that would have revealed it.
 *
 * Terminal by classification (`SubiektRetryClassifierAdapter`): the source's
 * tax treatment is a property of the order, so every retry re-reads the same
 * value and reaches the same refusal.
 *
 * @module libs/integrations/subiekt/src/domain/exceptions
 */
export class SubiektNetPricedOrderException extends Error {
  constructor(orderRef: string) {
    super(
      `Order ${orderRef} reports net (tax-exclusive) line prices, which cannot be written to a Subiekt ZK: ` +
        `the document is gross-priced (LiczonyOdCenBrutto) and OpenLinker does not compute tax to convert them. ` +
        `Only a source reporting gross (tax-inclusive) prices can be sent to Subiekt.`,
    );
    this.name = 'SubiektNetPricedOrderException';
    Error.captureStackTrace(this, this.constructor);
  }
}
