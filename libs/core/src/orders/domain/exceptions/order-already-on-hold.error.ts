/**
 * Order Already On Hold Error (#2338, REVIEW §3 H9)
 *
 * Raised by `OrderHoldRepositoryPort.placeIfNoneOpen` when the order already
 * carries an open hold, so `UQ_order_holds_open_order` refused the insert.
 *
 * **This is a DOMAIN error, and that is the point of the seam.** The repository
 * catches PostgreSQL's `23505` and translates; no `QueryFailedError` escapes the
 * port (`docs/engineering-standards.md § Repository Error Handling`, the
 * `DuplicateIdentifierMappingError` precedent). REVIEW H9 named this error
 * explicitly rather than leaving the concurrency story to be improvised at the
 * service layer, because four issues chain behind this one and would each
 * otherwise invent their own.
 *
 * Returning `null` instead was considered and rejected: it pushes the meaning to
 * every caller, and #2339's service, #2341's HTTP layer and #2342's automation
 * would each have to re-derive it. The error carries it once.
 *
 * NOT retryable: it reports persisted state, so a re-run reaches the same
 * conclusion. `placeIfNoneOpen` is therefore double-call-safe — a second call
 * writes nothing and says so.
 *
 * @module libs/core/src/orders/domain/exceptions
 */
export class OrderAlreadyOnHoldError extends Error {
  constructor(
    public readonly internalOrderId: string,
    /** The hold already holding the slot, so a caller can report or render it. */
    public readonly openHoldId: string
  ) {
    super(
      `Order ${internalOrderId} already has an open hold (${openHoldId})`
    );
    this.name = 'OrderAlreadyOnHoldError';

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, OrderAlreadyOnHoldError);
    }
  }
}
