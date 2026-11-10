/**
 * Return Gift Decision Repository Port (#3943)
 *
 * @module libs/core/src/returns/domain/ports
 */
import type {
  RecordReturnGiftDecisionInput,
  ReturnGiftDecision,
} from '../types/return-gift-decision.types';

export interface ReturnGiftDecisionRepositoryPort {
  /** Every decision recorded on a return, oldest first. */
  findByReturnId(returnId: string): Promise<ReturnGiftDecision[]>;

  /**
   * Records the decision for `(returnId, giftLineId)`, replacing an earlier one:
   * the operator may change their mind until the refund is made, and the row says
   * who decided last and when. One row per gift per return, enforced by the
   * unique index, so a double click cannot record it twice.
   */
  upsert(input: RecordReturnGiftDecisionInput, now: Date): Promise<ReturnGiftDecision>;
}
