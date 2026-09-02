import {
  FulfillmentAuthorityBlockReasonValues,
  FulfillmentAuthorityUnresolvedReasonValues,
  isFulfillmentAuthorityBlockReason,
  isFulfillmentAuthorityUnresolvedReason,
} from './fulfillment-authority-outcome.types';

describe('FulfillmentAuthorityBlockOutcome vocabulary', () => {
  it('should round-trip every block reason through its guard', () => {
    for (const reason of FulfillmentAuthorityBlockReasonValues) {
      expect(isFulfillmentAuthorityBlockReason(reason)).toBe(true);
    }
  });

  it('should round-trip every unresolved reason through its guard', () => {
    for (const reason of FulfillmentAuthorityUnresolvedReasonValues) {
      expect(isFulfillmentAuthorityUnresolvedReason(reason)).toBe(true);
    }
  });

  it('should keep the bridge value in the block union only', () => {
    // Two unions, one bridge value: `unresolved-authority` is the block reason
    // that carries an unresolved reason alongside it (#2100's shape).
    expect(FulfillmentAuthorityBlockReasonValues).toContain('unresolved-authority');
    expect(FulfillmentAuthorityUnresolvedReasonValues).not.toContain('unresolved-authority');
  });

  it('should keep the two unions disjoint so a reader never string-matches across them', () => {
    const overlap = FulfillmentAuthorityBlockReasonValues.filter((reason) =>
      (FulfillmentAuthorityUnresolvedReasonValues as readonly string[]).includes(reason),
    );
    expect(overlap).toEqual([]);
  });

  it.each(['', 'unknown-reason', 'none', undefined, 3, {}])(
    'should reject %p in both guards',
    (value) => {
      expect(isFulfillmentAuthorityBlockReason(value)).toBe(false);
      expect(isFulfillmentAuthorityUnresolvedReason(value)).toBe(false);
    },
  );
});
