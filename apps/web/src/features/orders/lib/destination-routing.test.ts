/**
 * `resolveDestinationRoutingCopy` unit tests (#2703 / #2704).
 */
import { describe, expect, it } from 'vitest';
import { getMessages } from '../../../shared/i18n';
import {
  DESTINATION_ROUTING_ATTENTION_REASONS,
  isDestinationRoutingBlockReason,
  resolveDestinationRoutingCopy,
  resolveDestinationRoutingSyncHint,
} from './destination-routing';

const copy = getMessages('orders');

describe('destination routing reason guard', () => {
  it.each(['toString', 'constructor', '__proto__', 'from-the-future', ''])(
    'should reject %p as a reason and resolve no copy for it',
    (value) => {
      expect(isDestinationRoutingBlockReason(value)).toBe(false);
      expect(resolveDestinationRoutingCopy(value, copy)).toBeNull();
    }
  );

  it('should accept a recognised reason', () => {
    expect(isDestinationRoutingBlockReason('routed-to-no-destination')).toBe(true);
  });

  it('should resolve a label, a hint and a tone for a recognised reason', () => {
    expect(resolveDestinationRoutingCopy('routed-to-no-destination', copy)).toEqual({
      label: 'Routed nowhere',
      hint: copy.destinationRouting.reasons['routed-to-no-destination'].hint,
      tone: 'decision',
    });
  });

  it('should count every reason except the routing decision', () => {
    expect(DESTINATION_ROUTING_ATTENTION_REASONS).not.toContain('routed-to-no-destination');
    expect(DESTINATION_ROUTING_ATTENTION_REASONS).toHaveLength(4);
  });
});

describe('resolveDestinationRoutingSyncHint', () => {
  it('should contribute nothing for an unrecognised or absent reason', () => {
    expect(resolveDestinationRoutingSyncHint(null, false, copy)).toBeNull();
    expect(resolveDestinationRoutingSyncHint('toString', false, copy)).toBeNull();
  });

  it('should contribute the partial hint only when destination rows exist', () => {
    expect(
      resolveDestinationRoutingSyncHint('routed-destinations-partially-unavailable', true, copy)
    ).toBe(copy.destinationRouting.partialSyncHint);
    expect(resolveDestinationRoutingSyncHint('routed-destinations-unavailable', true, copy)).toBeNull();
  });

  it('should contribute the attention pointer when no destination rows exist', () => {
    expect(resolveDestinationRoutingSyncHint('routed-destinations-unavailable', false, copy)).toBe(
      copy.destinationRouting.attentionSyncHint
    );
  });
});

// #3959 - a shop with nothing to copy its orders to.
describe('own-only destination reasons', () => {
  it('should keep no-destination-configured neutral and uncounted', () => {
    expect(resolveDestinationRoutingCopy('no-destination-configured', copy)?.tone).toBe('decision');
    expect(DESTINATION_ROUTING_ATTENTION_REASONS).not.toContain('no-destination-configured');
  });

  it('should show its own hint, not the attention pointer, when no destination rows exist', () => {
    expect(resolveDestinationRoutingSyncHint('no-destination-configured', false, copy)).toBe(
      copy.destinationRouting.reasons['no-destination-configured'].hint
    );
  });

  it.each(['no-destination-configured', 'no-active-destination'] as const)(
    'should read the %s label and hint from the orders namespace',
    (reason) => {
      const words = copy.destinationRouting.reasons[reason];
      expect(resolveDestinationRoutingCopy(reason, copy)).toMatchObject({
        label: words.label,
        hint: words.hint,
      });
    }
  );

  it('should count no-active-destination as outstanding work', () => {
    expect(resolveDestinationRoutingCopy('no-active-destination', copy)?.tone).toBe('attention');
    expect(DESTINATION_ROUTING_ATTENTION_REASONS).toContain('no-active-destination');
  });
});
