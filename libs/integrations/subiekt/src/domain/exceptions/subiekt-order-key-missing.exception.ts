/**
 * Subiekt Order Key Missing Exception
 *
 * Raised when an order reaches `createOrder` carrying neither an `orderNumber`
 * nor an `internalOrderId`, so there is no value to send as `orderRef`.
 *
 * `orderRef` is not a label. The bridge serializes the whole check-then-create
 * sequence on it AND looks up an already-created ZK by it, and its own comment
 * records the cost of an empty one: "an empty OrderRef has no natural key to
 * serialize on and runs unlocked". So a create with no key is both unserialized
 * against a concurrent peer and invisible to the retry that follows - and since
 * OpenLinker gives up at 30s while the bridge's COM call can run to 120s and
 * commit afterwards, that retry writes a SECOND sales order for one sale.
 *
 * It REFUSES rather than creating. A missing document is recoverable by the
 * operator; two sales orders for one sale are two real documents in somebody's
 * books, and no retry can undo the second one.
 *
 * Unreachable through `OrderSyncService`, which always populates
 * `internalOrderId` - this guards the seam rather than a workflow, which is why
 * the message names the contract rather than telling an operator to fix data
 * they do not control.
 *
 * Terminal by classification: a request that arrived without a key will arrive
 * without one on every retry.
 *
 * @module libs/integrations/subiekt/src/domain/exceptions
 */
export class SubiektOrderKeyMissingException extends Error {
  constructor() {
    super(
      'Cannot create a Subiekt sales order with no order key: the request carried neither ' +
        'an orderNumber nor an internalOrderId, and the destination needs one to serialize ' +
        'the create and to recognise a retry of it. Creating without a key risks a second ' +
        'sales order for the same sale, so the create is refused instead.',
    );
    this.name = 'SubiektOrderKeyMissingException';
    Error.captureStackTrace(this, this.constructor);
  }
}
