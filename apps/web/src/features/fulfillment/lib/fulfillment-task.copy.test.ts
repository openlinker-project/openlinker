/**
 * Copy-table tests (#2411).
 *
 * The load-bearing property is the FALLBACK: an action the server declares
 * legal but this build has no copy for must still be labelled and offered, and
 * a hint — which is a claim about what a button does — must NOT be invented.
 */
import { describe, expect, it } from 'vitest';

import {
  FULFILLMENT_ACTION_COPY,
  FULFILLMENT_EXPEDITED_BADGE,
  fulfillmentActionAppliedToast,
  fulfillmentActionFailedFallback,
  fulfillmentActionHint,
  fulfillmentActionLabel,
  fulfillmentActionTone,
  fulfillmentRequestStatusLabel,
  fulfillmentStatusLabel,
} from './fulfillment-task.copy';

describe('fulfillment task copy (#2411)', () => {
  it('should label the eight operator-invocable actions', () => {
    expect(Object.keys(FULFILLMENT_ACTION_COPY).sort()).toEqual([
      'close',
      'expedite',
      'force_cancel',
      'hold',
      'mark_in_progress',
      'release_expedite',
      'release_hold',
      'schedule',
    ]);
  });

  it('should humanise an action this build does not know rather than returning empty', () => {
    expect(fulfillmentActionLabel('split_across_locations')).toBe('Split across locations');
    expect(fulfillmentActionTone('split_across_locations')).toBe('secondary');
  });

  it('should NOT invent a hint for an unknown action', () => {
    expect(fulfillmentActionHint('split_across_locations')).toBeNull();
    expect(fulfillmentActionHint('hold')).not.toBeNull();
  });

  it('should humanise an unknown status and request status', () => {
    expect(fulfillmentStatusLabel('open')).toBe('Open');
    expect(fulfillmentStatusLabel('partially_picked')).toBe('Partially picked');
    expect(fulfillmentRequestStatusLabel('accepted')).toBe('Accepted');
    expect(fulfillmentRequestStatusLabel('some_new_state')).toBe('Some new state');
  });

  it('should mark force_cancel as the destructive action', () => {
    expect(fulfillmentActionTone('force_cancel')).toBe('danger');
  });

  it('should match the pack bench’s expedited badge, byte-for-byte (#3247)', () => {
    // One vocabulary, two surfaces (this file and
    // `features/bench/lib/bench-work.copy.ts`'s `row.expeditedBadge`). Not a
    // cross-feature import — `bench` exports nothing from its public barrel
    // for this, by design — so the match is pinned as a literal on each side
    // rather than shared, the same way `FULFILLMENT_EXPEDITED_BADGE` is
    // declared as its own constant instead of re-exported from `bench`.
    expect(FULFILLMENT_EXPEDITED_BADGE).toBe('Moved to the front');
  });

  it('should compose the applied and failed-fallback toast sentences from the action label', () => {
    expect(fulfillmentActionAppliedToast('close')).toBe('Close applied.');
    expect(fulfillmentActionFailedFallback('close')).toBe(
      'Could not close this fulfilment task.'
    );
    // The fallback lower-cases the label — "Force cancel" reads correctly
    // inside the sentence, not shouted mid-clause.
    expect(fulfillmentActionFailedFallback('force_cancel')).toBe(
      'Could not force cancel this fulfilment task.'
    );
  });
});
