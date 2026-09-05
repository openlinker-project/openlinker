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
});
