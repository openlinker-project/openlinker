/**
 * Return Reason Mapper — unit spec (#2328)
 *
 * The round-trip case is the load-bearing one: every member of the union must
 * survive unchanged, because this rule sits on BOTH the ingestion write path
 * and the repository read path. A member that silently degraded to `'other'`
 * would rewrite an operator's reason on the way through and nothing else in the
 * tree would notice.
 *
 * @module libs/core/src/returns/domain
 */
import { RefundReasonValues } from '@openlinker/core/orders/types';
import { narrowRefundReason, toRefundReasonOrOther } from './return-reason.mapper';

describe('return-reason.mapper', () => {
  describe('narrowRefundReason', () => {
    it.each(RefundReasonValues)('should round-trip the union member %s unchanged', (reason) => {
      expect(narrowRefundReason(reason)).toBe(reason);
    });

    it('should return null for a reason outside the union', () => {
      expect(narrowRefundReason('BUYER_CHANGED_THEIR_MIND')).toBeNull();
    });

    it.each([null, undefined])('should return null when the source said nothing (%s)', (input) => {
      expect(narrowRefundReason(input)).toBeNull();
    });
  });

  describe('toRefundReasonOrOther', () => {
    it.each(RefundReasonValues)('should round-trip the union member %s unchanged', (reason) => {
      expect(toRefundReasonOrOther(reason)).toBe(reason);
    });

    it('should fall back to other rather than throwing on an unrecognised reason', () => {
      // Open-world by contract: a marketplace may invent a word at any time,
      // and refusing the return over it would discard a real parcel.
      expect(toRefundReasonOrOther('¯\\_(ツ)_/¯')).toBe('other');
    });

    it.each([null, undefined])('should fall back to other when the source said nothing (%s)', (input) => {
      expect(toRefundReasonOrOther(input)).toBe('other');
    });
  });
});
