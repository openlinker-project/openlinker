import {
  FulfillmentCancellationReasonValues,
  isFulfillmentCancellationReason,
} from './fulfillment-cancellation-reason.types';

describe('FulfillmentCancellationReason', () => {
  it('should round-trip every reason through its guard', () => {
    for (const reason of FulfillmentCancellationReasonValues) {
      expect(isFulfillmentCancellationReason(reason)).toBe(true);
    }
  });

  it('should carry the design-verbatim operator force-close reason', () => {
    // DESIGN §2.2: an audited operator force-closes to `cancelled` with reason
    // `operator_forced` — the one member written literally in the design.
    expect(FulfillmentCancellationReasonValues).toContain('operator_forced');
  });

  it('should declare the reviewed inferred set alongside it', () => {
    expect([...FulfillmentCancellationReasonValues]).toEqual([
      'operator_forced',
      'holder_rejected',
      'holder_unreachable',
      'rerouted',
      'order_cancelled',
    ]);
  });

  it('should spell every member in snake_case so none diverges from operator_forced', () => {
    for (const reason of FulfillmentCancellationReasonValues) {
      expect(reason).toMatch(/^[a-z]+(_[a-z]+)*$/);
    }
  });

  it.each(['', 'closed', 'operator-forced', undefined, null, 5])(
    'should reject %p when the guard narrows it',
    (value) => {
      expect(isFulfillmentCancellationReason(value)).toBe(false);
    },
  );
});
