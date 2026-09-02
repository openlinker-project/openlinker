/**
 * Refund reason vocabulary (#2382)
 *
 * The browser mirror of core's `RefundReasonValues`
 * (`libs/core/src/orders/domain/types/refund-record.types.ts`), which the
 * frontend cannot import — `apps/web` has no `@openlinker/*` dependency (#591).
 *
 * **It lives in `orders`, not `returns`, and that placement is load-bearing.**
 * `refund_records` is an orders table and `IOrderRefundService` is an orders
 * service, so orders owns the concept; a return is merely the first surface to
 * render it. Two consumers are already in view — the return money panel and the
 * order-level capture path — and the whole point of one home is that they cannot
 * spell the vocabulary two ways. Two lists agree right up until someone adds a
 * reason to one of them.
 *
 * There is deliberately **no mirror script**. A `check-*-mirror.mjs` exists to
 * hold two independently authored halves identical across a boundary that
 * forbids imports; that is exactly this boundary, so one would be defensible —
 * but the failure mode it guards is a value DIVERGING, and an unknown reason
 * here is already handled below by rendering the raw value rather than dropping
 * it. Revisit if a reason is ever removed from core rather than added.
 *
 * @module apps/web/src/features/orders/lib
 */

export const REFUND_REASON_VALUES = [
  'withdrawal',
  'defective',
  'not_as_described',
  'wrong_item',
  'other',
] as const;

export type RefundReason = (typeof REFUND_REASON_VALUES)[number];

export const REFUND_REASON_LABELS: Record<RefundReason, string> = {
  withdrawal: 'Buyer changed their mind',
  defective: 'Item was faulty',
  not_as_described: 'Item did not match the listing',
  wrong_item: 'Wrong item was sent',
  other: 'Something else',
};

/**
 * Label a reason this build may not know.
 *
 * A reason added to core after this build shipped renders as its raw value
 * rather than as a blank or a guessed label: the operator can still read what
 * was recorded and quote it, which a blank cell cannot do.
 */
export function describeRefundReason(reason: string): string {
  return reason in REFUND_REASON_LABELS
    ? REFUND_REASON_LABELS[reason as RefundReason]
    : reason;
}

export function isRefundReason(value: string): value is RefundReason {
  return (REFUND_REASON_VALUES as readonly string[]).includes(value);
}
