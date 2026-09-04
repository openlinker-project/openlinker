import {
  FulfillmentWorkActionValues,
  isFulfillmentWorkAction,
} from './fulfillment-work-action.types';
import { FulfillmentRequestStatusValues } from './fulfillment-request-status.types';

describe('FulfillmentWorkActionValues', () => {
  it('should hold exactly the fourteen members', () => {
    expect(FulfillmentWorkActionValues).toEqual([
      'schedule',
      'submit',
      'accept',
      'reject',
      'request_cancellation',
      'accept_cancellation',
      'reject_cancellation',
      'hold',
      'release_hold',
      'mark_in_progress',
      'close',
      'force_cancel',
      'expedite',
      'release_expedite',
    ]);
  });

  it('should carry an action for every non-initial member of the negotiation axis', () => {
    // A negotiation state nothing can reach is a state the vocabulary cannot honour.
    const reachable = FulfillmentRequestStatusValues.filter((state) => state !== 'unsubmitted');
    const actionFor: Record<string, string> = {
      submitted: 'submit',
      accepted: 'accept',
      rejected: 'reject',
      cancellation_requested: 'request_cancellation',
      cancellation_accepted: 'accept_cancellation',
      cancellation_rejected: 'reject_cancellation',
    };

    for (const state of reachable) {
      expect(FulfillmentWorkActionValues).toContain(actionFor[state]);
    }
  });

  it('should reach `scheduled` by an action, closing the gap the review found', () => {
    expect(FulfillmentWorkActionValues).toContain('schedule');
  });

  it('should keep `close` and `force_cancel` distinct, per ADR-054', () => {
    expect(FulfillmentWorkActionValues).toContain('close');
    expect(FulfillmentWorkActionValues).toContain('force_cancel');
  });

  it('should hold no duplicate member', () => {
    expect(new Set(FulfillmentWorkActionValues).size).toBe(FulfillmentWorkActionValues.length);
  });
});

describe('isFulfillmentWorkAction', () => {
  it.each(FulfillmentWorkActionValues)('should narrow %s when the value is a member', (value) => {
    expect(isFulfillmentWorkAction(value)).toBe(true);
  });

  it.each([
    ['a state rather than an action', 'in_progress'],
    ['a progress event, which is never an action', 'short_picked'],
    ['an unrecognised string', 'wave'],
    ['null', null],
  ])('should reject %s', (_label, value) => {
    expect(isFulfillmentWorkAction(value)).toBe(false);
  });
});
