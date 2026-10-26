/**
 * Order Cancel Types (#3540)
 *
 * The closed vocabulary of WHY an operator cancels an order. Carried on the
 * `order.cancel_request` change payload and relayed to the source as the
 * lifecycle event's free-text `reason`. No buyer data.
 *
 * The pure-rule exception in `docs/engineering-standards.md` applies: the guard
 * IS the rule for the union and is edited in the same commit as it.
 *
 * @module libs/core/src/orders/domain/types
 */

export const OrderCancelReasonValues = [
  'buyer-request',
  'out-of-stock',
  'fraud',
  'duplicate',
  'other',
] as const;

export type OrderCancelReason = (typeof OrderCancelReasonValues)[number];

export function isOrderCancelReason(value: unknown): value is OrderCancelReason {
  return typeof value === 'string' && (OrderCancelReasonValues as readonly string[]).includes(value);
}

/** `other` is the one reason a code cannot explain, so it must carry operator text. */
export function orderCancelReasonRequiresNote(reason: OrderCancelReason): boolean {
  return reason === 'other';
}

/**
 * The `originConnectionId` an operator-initiated lifecycle relay carries (#3540).
 *
 * The relay excludes the event's origin from its targets (self-echo
 * suppression). An operator's cancel did NOT come from any connection, so it
 * must exclude none - in particular not the SOURCE marketplace, which is the one
 * participant that has to be told. A non-connection sentinel is the precedent
 * `openlinker:automation` set for the automation executor; this is its operator
 * counterpart.
 */
export const OPERATOR_ORDER_ORIGIN_ID = 'openlinker:operator';

/**
 * Dedupe key of the `marketplace.offer.stockRestore` job for a cancelled order.
 *
 * ONE definition shared by the ingestion path (a source reported the
 * cancellation) and the operator-cancel path (OpenLinker cancelled it), so
 * whichever observes the cancellation first enqueues the restore and the other
 * is a harmless no-op. Two spellings would restore the stock twice.
 */
export function orderStockRestoreDedupeKey(connectionId: string, internalOrderId: string): string {
  return `marketplace:${connectionId}:stockRestore:${internalOrderId}`;
}
