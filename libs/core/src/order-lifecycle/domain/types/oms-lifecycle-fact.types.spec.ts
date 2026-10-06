/**
 * OmsLifecycleFact — vocabulary + split-invariant specs (#2305)
 *
 * The load-bearing assertion here is the SPLIT (design §6.6): no internal fact
 * type may also be a relay event type. Asserted mechanically rather than by
 * docblock, because the failure mode it prevents is silent — a member added to
 * both unions would compile, and would then oblige four writeback adapters to
 * answer for an internal warehouse fact.
 *
 * @module libs/core/src/order-lifecycle/domain/types
 */
import { OrderLifecycleEventTypeValues } from '@openlinker/core/orders';

import {
  OmsLifecycleFactTypeValues,
  isOmsLifecycleFactType,
} from './oms-lifecycle-fact.types';

describe('OmsLifecycleFact (#2305)', () => {
  it('should carry exactly the nine design §6.6 fact types', () => {
    expect(OmsLifecycleFactTypeValues).toEqual([
      'held',
      'released',
      'routed',
      'work-accepted',
      'work-rejected',
      'short-picked',
      'amendment-requested',
      'amendment-confirmed',
      'amendment-declined',
    ]);
  });

  describe('the split invariant (design §6.6 — split, not grown)', () => {
    it('should share no member with the relay union', () => {
      const relay = new Set<string>(OrderLifecycleEventTypeValues);
      const overlap = OmsLifecycleFactTypeValues.filter((type) =>
        relay.has(type),
      );

      expect(overlap).toEqual([]);
    });

    // #3526 widened the relay union deliberately (`delivered`, `in-progress` —
    // both EXTERNAL lifecycle facts a channel can show). Pinned so that any
    // further widening is a reviewed decision; the split itself is the overlap
    // assertion above, which still forbids an internal OMS fact from joining.
    it('should hold the relay union at its #2286 + #3526 members', () => {
      expect(OrderLifecycleEventTypeValues).toEqual([
        'dispatched',
        'cancelled',
        'delivered',
        'in-progress',
      ]);
    });
  });

  describe('isOmsLifecycleFactType', () => {
    it.each(OmsLifecycleFactTypeValues)('should accept %s', (type) => {
      expect(isOmsLifecycleFactType(type)).toBe(true);
    });

    it.each(['', 'dispatched', 'shortPicked', 'work_accepted'])(
      'should reject %p',
      (value) => {
        expect(isOmsLifecycleFactType(value)).toBe(false);
      },
    );

    it.each([undefined, null, 0, {}, []])(
      'should reject the non-string %p',
      (value) => {
        expect(isOmsLifecycleFactType(value)).toBe(false);
      },
    );
  });
});
