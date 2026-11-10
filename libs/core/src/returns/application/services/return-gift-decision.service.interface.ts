/**
 * Return Gift Decision Service Interface (#3943, gifts spec section 9)
 *
 * Records what the operator decided about a gift on a return. It decides
 * nothing: a gift with no decision is simply undecided, OpenLinker never deducts
 * a kept gift by itself (rule G5), and the refund is never changed by this
 * service. The refund hint the operator sees reads the recorded `deduct`
 * decisions; applying any figure stays the operator's own act.
 *
 * @module libs/core/src/returns/application/services
 */
import type {
  RecordReturnGiftDecisionInput,
  ReturnGiftDecision,
} from '../../domain/types/return-gift-decision.types';

export interface IReturnGiftDecisionService {
  /** Every gift decision on the return. Throws `ReturnNotFoundError` for an unknown return. */
  list(returnId: string): Promise<ReturnGiftDecision[]>;

  /**
   * Records (or replaces) the decision for one gift. Refuses a return that is not
   * attributed to an order, like every downstream trigger (`ReturnNotAttributedError`),
   * and a `deduct` without a positive amount (`ReturnGiftDecisionInvalidError`).
   */
  decide(input: RecordReturnGiftDecisionInput): Promise<ReturnGiftDecision>;
}
