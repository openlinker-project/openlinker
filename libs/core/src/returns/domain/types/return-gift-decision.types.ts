/**
 * Return Gift Decision Types (#3943, gifts spec section 9, rule G5)
 *
 * A return of a line that has a gift does not change the gift. What happens to
 * the gift is a DECISION the operator makes and OpenLinker records; it never
 * deducts a kept gift on its own. Until the operator decides, a gift has no
 * decision at all (absence), which is not the same as `keep`.
 *
 * @module libs/core/src/returns/domain/types
 */

/** `keep` the customer keeps it; `ask_back` it is expected back; `deduct` its value is taken off the refund. */
export const ReturnGiftDecisionValues = ['keep', 'ask_back', 'deduct'] as const;
export type ReturnGiftDecisionValue = (typeof ReturnGiftDecisionValues)[number];

export function isReturnGiftDecision(value: unknown): value is ReturnGiftDecisionValue {
  return typeof value === 'string' && (ReturnGiftDecisionValues as readonly string[]).includes(value);
}

export interface ReturnGiftDecision {
  id: string;
  returnId: string;
  /** The order line id of the gift (an `OrderItem.id`, or the bundle line that carries a slot). */
  giftLineId: string;
  decision: ReturnGiftDecisionValue;
  /**
   * The gross amount the operator chose to take off the refund. Set only for
   * `deduct`; `null` for the other two. Recorded as decided, so a later price
   * change cannot move a figure the operator already confirmed.
   */
  deductionGross: string | null;
  note: string | null;
  decidedByUserId: string | null;
  decidedAt: Date;
}

export interface RecordReturnGiftDecisionInput {
  returnId: string;
  giftLineId: string;
  decision: ReturnGiftDecisionValue;
  deductionGross?: number | null;
  note?: string | null;
  actorUserId: string | null;
  /**
   * The gift line ids of the return's order (a gift line, or a gift-slot line of a
   * set). `returns` cannot read orders, so the caller passes them in; a line not in
   * the list is refused rather than recorded against an unrelated order's line.
   */
  validGiftLineIds: readonly string[];
}
