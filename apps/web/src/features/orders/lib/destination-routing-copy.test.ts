/**
 * `resolveDestinationRoutingCopy` unit tests (#2703 / #2704).
 */
import { describe, expect, it } from 'vitest';
import {
  DESTINATION_ROUTING_ATTENTION_SYNC_HINT,
  DESTINATION_ROUTING_PARTIAL_SYNC_HINT,
  isDestinationRoutingBlockReason,
  resolveDestinationRoutingCopy,
  resolveDestinationRoutingSyncHint,
} from './destination-routing-copy';

describe('destination routing reason guard', () => {
  it.each(['toString', 'constructor', '__proto__', 'from-the-future', ''])(
    'should reject %p as a reason and resolve no copy for it',
    (value) => {
      expect(isDestinationRoutingBlockReason(value)).toBe(false);
      expect(resolveDestinationRoutingCopy(value)).toBeNull();
    }
  );

  it('should accept a recognised reason', () => {
    expect(isDestinationRoutingBlockReason('routed-to-no-destination')).toBe(true);
  });
});

describe('resolveDestinationRoutingSyncHint', () => {
  it('should contribute nothing for an unrecognised or absent reason', () => {
    expect(resolveDestinationRoutingSyncHint(null, false)).toBeNull();
    expect(resolveDestinationRoutingSyncHint('toString', false)).toBeNull();
  });

  it('should contribute the partial hint only when destination rows exist', () => {
    expect(
      resolveDestinationRoutingSyncHint('routed-destinations-partially-unavailable', true)
    ).toBe(DESTINATION_ROUTING_PARTIAL_SYNC_HINT);
    expect(resolveDestinationRoutingSyncHint('routed-destinations-unavailable', true)).toBeNull();
  });

  it('should contribute the attention pointer when no destination rows exist', () => {
    expect(resolveDestinationRoutingSyncHint('routed-destinations-unavailable', false)).toBe(
      DESTINATION_ROUTING_ATTENTION_SYNC_HINT
    );
  });
});
