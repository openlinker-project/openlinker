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

    it('should leave the relay union untouched at its two #2286 members', () => {
      expect(OrderLifecycleEventTypeValues).toEqual(['dispatched', 'cancelled']);
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
