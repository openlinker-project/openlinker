/**
 * `summariseFulfillmentWork` (#3099/#3103, ADR-075).
 *
 * One case per state the design of record demonstrates, plus the property
 * that matters most: an unrecognised `(status, requestStatus)` combination
 * renders no sentence rather than a guessed one.
 */
import { describe, expect, it } from 'vitest';

import { summariseFulfillmentWork, type FulfillmentWorkSummaryInput } from './fulfillment-work-summary';

function input(overrides: Partial<FulfillmentWorkSummaryInput> = {}): FulfillmentWorkSummaryInput {
  return {
    status: 'open',
    requestStatus: 'unsubmitted',
    activeHoldCount: 0,
    locationId: null,
    expeditedAt: null,
    cancellationReason: null,
    executorName: null,
    ...overrides,
  };
}

describe('summariseFulfillmentWork', () => {
  it('names the executor by its resolved display name when one is known', () => {
    expect(
      summariseFulfillmentWork(
        input({ status: 'in_progress', locationId: 'ol_location_1', executorName: 'DPD Polska' })
      )
    ).toBe('DPD Polska is picking and packing this right now.');
  });

  it('falls back to "Whoever is working this task" when the executor is not known', () => {
    expect(
      summariseFulfillmentWork(input({ status: 'in_progress', locationId: 'ol_location_1' }))
    ).toBe('Whoever is working this task is picking and packing this right now.');
  });

  it('marks an in-progress task as expedited when expeditedAt is set', () => {
    expect(
      summariseFulfillmentWork(
        input({
          status: 'in_progress',
          locationId: 'ol_location_1',
          expeditedAt: '2026-09-20T10:00:00.000Z',
          executorName: 'DPD Polska',
        })
      )
    ).toBe(
      'DPD Polska is picking and packing this right now, ahead of its usual place in the queue.'
    );
  });

  it('reports a scheduled task', () => {
    expect(
      summariseFulfillmentWork(
        input({ status: 'scheduled', locationId: 'ol_location_1', executorName: 'DPD Polska' })
      )
    ).toBe('DPD Polska will start picking this soon.');
  });

  it('reports a closed task with no subject at all', () => {
    expect(summariseFulfillmentWork(input({ status: 'closed' }))).toBe('This task is finished.');
  });

  it('reports an incomplete task', () => {
    expect(summariseFulfillmentWork(input({ status: 'incomplete', executorName: 'DPD Polska' }))).toBe(
      'DPD Polska could only pack part of this. Needs re-sourcing or a manual decision.'
    );
  });

  it('says nothing to pick yet when a scheduled task has no location', () => {
    expect(summariseFulfillmentWork(input({ status: 'scheduled', locationId: null }))).toBe(
      'Not yet assigned anywhere, so there is nothing to pick until it is routed.'
    );
  });

  it('says nothing to pick yet when an open task has no location', () => {
    expect(summariseFulfillmentWork(input({ status: 'open', locationId: null }))).toBe(
      'Not yet assigned anywhere, so there is nothing to pick until it is routed.'
    );
  });

  it('does NOT say "nothing to pick" for a closed task with no location — the guard is status-scoped', () => {
    // A task can reach `in_progress` or `closed` while `locationId` stays
    // null on the default `omp_fulfilled` topology. Confirms the unassigned
    // branch only fires for `open`/`scheduled`.
    expect(summariseFulfillmentWork(input({ status: 'closed', locationId: null }))).toBe(
      'This task is finished.'
    );
  });

  describe('heldness outranks the bare status', () => {
    it('reports a single hold in the singular', () => {
      expect(
        summariseFulfillmentWork(input({ status: 'in_progress', activeHoldCount: 1 }))
      ).toBe('One thing is stopping this. See below.');
    });

    it('reports several holds with a numeral', () => {
      expect(
        summariseFulfillmentWork(input({ status: 'in_progress', activeHoldCount: 3 }))
      ).toBe('3 things are stopping this. See below.');
    });

    it('outranks the negotiation axis too', () => {
      expect(
        summariseFulfillmentWork(
          input({ status: 'open', requestStatus: 'cancellation_requested', activeHoldCount: 1 })
        )
      ).toBe('One thing is stopping this. See below.');
    });
  });

  describe('the negotiation axis', () => {
    it('reports an offer awaiting an answer', () => {
      expect(
        summariseFulfillmentWork(
          input({ requestStatus: 'submitted', locationId: 'ol_location_1', executorName: 'DPD Polska' })
        )
      ).toBe('Asked DPD Polska to take this. No answer yet.');
    });

    it('reports a cancellation request the holder has not answered', () => {
      expect(
        summariseFulfillmentWork(
          input({ requestStatus: 'cancellation_requested', executorName: 'DPD Polska' })
        )
      ).toBe('Asked DPD Polska to stop. They have not answered, so packing may still be happening.');
    });

    it('reports a refused cancellation', () => {
      expect(
        summariseFulfillmentWork(
          input({ requestStatus: 'cancellation_rejected', executorName: 'DPD Polska' })
        )
      ).toBe('DPD Polska said no to the cancellation, so this is going ahead.');
    });
  });

  describe('the cancelled branch, keyed on cancellationReason', () => {
    it('attributes an operator-forced cancel to the operator, not the holder', () => {
      expect(
        summariseFulfillmentWork(
          input({ status: 'cancelled', cancellationReason: 'operator_forced', executorName: 'DPD Polska' })
        )
      ).toBe('DPD Polska was told to stop.');
    });

    it('reports the holder giving it back on a rejection', () => {
      expect(
        summariseFulfillmentWork(
          input({ status: 'cancelled', cancellationReason: 'holder_rejected', executorName: 'DPD Polska' })
        )
      ).toBe('DPD Polska gave this back.');
    });

    it('reports the holder giving it back when unreachable', () => {
      expect(
        summariseFulfillmentWork(
          input({
            status: 'cancelled',
            cancellationReason: 'holder_unreachable',
            executorName: 'DPD Polska',
          })
        )
      ).toBe('DPD Polska gave this back.');
    });

    it('says nothing for a rerouted cancellation — the executor did nothing wrong', () => {
      expect(
        summariseFulfillmentWork(input({ status: 'cancelled', cancellationReason: 'rerouted' }))
      ).toBeNull();
    });

    it('says nothing when the order itself was cancelled', () => {
      expect(
        summariseFulfillmentWork(
          input({ status: 'cancelled', cancellationReason: 'order_cancelled' })
        )
      ).toBeNull();
    });

    it('says nothing for a cancelled task with no reason recorded', () => {
      expect(
        summariseFulfillmentWork(input({ status: 'cancelled', cancellationReason: null }))
      ).toBeNull();
    });
  });

  describe('the fail-safe: an unrecognised combination renders nothing', () => {
    it('returns null for an open task, accepted, no holds, with a location', () => {
      // One of the three states the module docblock names as reachable and
      // deliberately unworded: a task whose holder accepted and has not
      // started picking.
      expect(
        summariseFulfillmentWork(
          input({ status: 'open', requestStatus: 'accepted', locationId: 'ol_location_1' })
        )
      ).toBeNull();
    });

    it('returns null for an open, unsubmitted task with a location and no holds', () => {
      expect(
        summariseFulfillmentWork(
          input({ status: 'open', requestStatus: 'unsubmitted', locationId: 'ol_location_1' })
        )
      ).toBeNull();
    });

    it('returns null for a rejected request', () => {
      expect(summariseFulfillmentWork(input({ requestStatus: 'rejected' }))).toBeNull();
    });

    it('returns null for a wholly unrecognised status the frontend cannot mirror', () => {
      expect(
        summariseFulfillmentWork(input({ status: 'awaiting_wave', locationId: 'ol_location_1' }))
      ).toBeNull();
    });
  });

  it('never mutates its argument', () => {
    const frozen = Object.freeze(input({ status: 'in_progress', locationId: 'ol_location_1' }));
    expect(() => summariseFulfillmentWork(frozen)).not.toThrow();
  });
});
