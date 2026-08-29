/**
 * Return Line Types — vocabulary spec (#2327)
 *
 * These are literal assertions on purpose. Each union below is an ADJUDICATED
 * decision recorded in the issue's acceptance criteria, not an incidental list:
 * a later edit that "completes" custody with `inspected`, or that adds
 * `refurbish` to disposition, is reversing a decision and should have to say so
 * by editing this file.
 *
 * @module domain/types
 */
import {
  REFUND_ATTEMPTABLE_MONEY_STATES,
  ReturnCustodyStateValues,
  ReturnDispositionValues,
  ReturnMoneyStateValues,
  blocksRefundAttempt,
  isRefundAttemptable,
} from './return-line.types';
import { ReturnOriginValues } from './return.types';

describe('return line vocabularies (#2327)', () => {
  describe('ReturnCustodyStateValues', () => {
    it('should have exactly five members when read', () => {
      expect(ReturnCustodyStateValues).toHaveLength(5);
    });

    it('should not include "inspected" when read (collapsed into "received")', () => {
      expect(ReturnCustodyStateValues as readonly string[]).not.toContain('inspected');
    });

    it('should be the exact adjudicated list when read', () => {
      expect(ReturnCustodyStateValues).toEqual([
        'advised',
        'in_transit',
        'received',
        'disposed',
        'not_returned',
      ]);
    });
  });

  describe('ReturnMoneyStateValues', () => {
    it('should include "in_doubt" when read (OL ships no refund write to observe)', () => {
      expect(ReturnMoneyStateValues as readonly string[]).toContain('in_doubt');
    });

    it('should be the exact adjudicated list when read', () => {
      expect(ReturnMoneyStateValues).toEqual([
        'not_refundable',
        'pending',
        'triggered',
        'refunded',
        'denied',
        'in_doubt',
      ]);
    });
  });

  describe('ReturnDispositionValues', () => {
    it('should be exactly restock and scrap when read', () => {
      expect(ReturnDispositionValues).toEqual(['restock', 'scrap']);
    });
  });

  describe('ReturnOriginValues', () => {
    it('should be exactly the two origins when read', () => {
      expect(ReturnOriginValues).toEqual(['source_ingested', 'operator_authored']);
    });
  });

  /**
   * The custody and money axes are ORTHOGONAL (ADR-060) — marketplaces
   * routinely refund before goods arrive. Asserting they share no member is the
   * cheapest available guard against a future edit collapsing them back into
   * one "return state" whose values would inevitably start to overlap.
   */
  it('should keep the custody and money vocabularies disjoint when compared', () => {
    const overlap = (ReturnCustodyStateValues as readonly string[]).filter((value) =>
      (ReturnMoneyStateValues as readonly string[]).includes(value)
    );
    expect(overlap).toEqual([]);
  });
});

describe('refund attemptability (#2371)', () => {
  it('should permit an attempt only from the three non-crossing states', () => {
    expect(REFUND_ATTEMPTABLE_MONEY_STATES).toEqual(['not_refundable', 'pending', 'denied']);
  });

  it.each(['not_refundable', 'pending', 'denied'] as const)(
    'should treat %s as attemptable',
    (state) => {
      expect(isRefundAttemptable(state)).toBe(true);
      expect(blocksRefundAttempt(state)).toBe(false);
    }
  );

  it.each(['triggered', 'refunded', 'in_doubt'] as const)('should block from %s', (state) => {
    // Each means a boundary was crossed or a settlement stands; a second
    // attempt from any of them risks refunding the buyer twice.
    expect(isRefundAttemptable(state)).toBe(false);
    expect(blocksRefundAttempt(state)).toBe(true);
  });

  it('should partition the whole money union with no value left undecided', () => {
    for (const state of ReturnMoneyStateValues) {
      expect(isRefundAttemptable(state)).toBe(!blocksRefundAttempt(state));
    }
  });
});
