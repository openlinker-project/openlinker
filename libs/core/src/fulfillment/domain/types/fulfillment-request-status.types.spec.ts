import {
  FulfillmentRequestStatusValues,
  isFulfillmentRequestStatus,
} from './fulfillment-request-status.types';
import { FulfillmentWorkStatusValues } from './fulfillment-work-status.types';

describe('FulfillmentRequestStatusValues', () => {
  it('should hold exactly the seven design-verbatim members in DESIGN §5.2 order', () => {
    expect(FulfillmentRequestStatusValues).toEqual([
      'unsubmitted',
      'submitted',
      'accepted',
      'rejected',
      'cancellation_requested',
      'cancellation_accepted',
      'cancellation_rejected',
    ]);
  });

  it('should carry a distinct member for a REFUSED cancellation, which a merged axis cannot express', () => {
    expect(FulfillmentRequestStatusValues).toContain('cancellation_rejected');
  });

  it('should share no member with the execution axis, so the two never collapse', () => {
    const overlap = FulfillmentRequestStatusValues.filter((value) =>
      (FulfillmentWorkStatusValues as readonly string[]).includes(value),
    );
    expect(overlap).toEqual([]);
  });
});

describe('isFulfillmentRequestStatus', () => {
  it.each(FulfillmentRequestStatusValues)(
    'should narrow %s when the value is a member',
    (value) => {
      expect(isFulfillmentRequestStatus(value)).toBe(true);
    },
  );

  it.each([
    ['an execution-axis member', 'in_progress'],
    ['an unrecognised string', 'cancellation_pending'],
    ['null', null],
    ['undefined', undefined],
  ])('should reject %s', (_label, value) => {
    expect(isFulfillmentRequestStatus(value)).toBe(false);
  });
});
