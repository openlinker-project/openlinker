/**
 * Amazon MCF Order Id Policy (#4185)
 *
 * The `sellerFulfillmentOrderId` of the MCF order for one dispatch attempt,
 * derived from OpenLinker's work idempotency key (`work:{workId}:{attempt}`),
 * so a retry of the same attempt addresses the same Amazon order and never a
 * second one. Amazon takes at most 40 characters, letters, digits, `-` and `_`;
 * the key is longer and contains `:`, so the id is a hash of it.
 *
 * @module libs/integrations/amazon/src/domain/policies
 */
import { createHash } from 'node:crypto';

export function amazonMcfOrderId(dispatchIdempotencyKey: string): string {
  return `OL-${createHash('sha256').update(dispatchIdempotencyKey).digest('hex').slice(0, 32)}`;
}

/** The dispatch key a cancellation key (`{dispatch}:cancel`) belongs to. */
export function dispatchKeyOfCancellation(cancellationKey: string): string {
  return cancellationKey.replace(/:cancel$/, '');
}

/** The id Amazon shows the buyer: the OpenLinker order id without its prefix, within 40 characters. */
export function amazonMcfDisplayableOrderId(orderId: string): string {
  return orderId.replace(/^ol_order_/, '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
}
