/**
 * `resolveDestinationRoutingCopy` unit tests (#2703 / #2704).
 */
import { describe, expect, it } from 'vitest';
import { isDestinationRoutingBlockReason, resolveDestinationRoutingCopy } from './destination-routing-copy';

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
