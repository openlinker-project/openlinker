/**
 * Refund Ceiling Decision (#3289)
 *
 * Turns a {@link RefundCeilingVerdict} into the one decision both enforcement
 * points apply - refuse, let an acknowledged excess through, or proceed on an
 * unknown ceiling - so the returns pre-flight and the `RefundRecord` write can
 * never decide differently. Pure; callers own the logging.
 *
 * @module libs/core/src/orders/domain/domain-services
 */
import { RefundCeilingExceededException } from '../exceptions/refund-ceiling-exceeded.exception';
import type { RefundCeilingVerdict } from '../types/refund-ceiling.types';

export type RefundCeilingDisposition = 'passed' | 'acknowledged' | 'unknown';

/**
 * @throws {RefundCeilingExceededException} the verdict is `exceeded` and the
 *   caller did not acknowledge it.
 */
export function decideRefundCeiling(
  internalOrderId: string,
  verdict: RefundCeilingVerdict,
  acknowledgeAboveCeiling: boolean | undefined
): RefundCeilingDisposition {
  switch (verdict.status) {
    case 'within':
      return 'passed';
    case 'unknown':
      return 'unknown';
    case 'exceeded':
      if (acknowledgeAboveCeiling === true) {
        return 'acknowledged';
      }
      throw new RefundCeilingExceededException(
        internalOrderId,
        verdict.ceiling,
        verdict.alreadyRefunded,
        verdict.requested,
        verdict.currency
      );
  }
}
