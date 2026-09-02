/**
 * Return Not Attributed Error
 *
 * Raised when a downstream trigger is attempted against an ORPHAN return — one whose
 * `internalOrderId` is NULL because OL could not name the order it belongs to (#2332,
 * ADR-060).
 *
 * **Why this throws rather than returning a boolean.** A boolean is ignorable, and the
 * whole point of the block is that a downstream trigger cannot proceed by omission. The
 * three flows this guards (`restock`, `refund`, `invoice_correction`) move stock, money
 * and a fiscal document; each of them acting against an order OL cannot name is exactly
 * the failure `internalOrderId`'s nullability exists to prevent, and none is recoverable
 * by a later log line.
 *
 * Both fields are exposed readonly rather than only interpolated into the message: an
 * HTTP filter (#2334) maps this to a status code and renders the trigger, and
 * string-parsing a message to do that is how the two drift.
 *
 * @module domain/exceptions
 */
import type { ReturnDownstreamTrigger } from '../types/return-trigger.types';

export class ReturnNotAttributedError extends Error {
  constructor(
    public readonly returnId: string,
    public readonly trigger: ReturnDownstreamTrigger
  ) {
    super(
      `Return ${returnId} is not attributed to an order — the "${trigger}" trigger is blocked. ` +
        `Attribute the return to an order first (the re-attribution reconcile does this ` +
        `automatically once the order is ingested).`
    );
    this.name = 'ReturnNotAttributedError';
    Error.captureStackTrace(this, this.constructor);
  }
}
