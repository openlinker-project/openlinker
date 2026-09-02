/**
 * Specs for `deriveOrderLifecyclePhase` (#2307).
 *
 * The precedence assertions read the ordinal from
 * `ORDER_LIFECYCLE_PHASE_PRECEDENCE` rather than restating 1..9, so a
 * reordering of `OrderLifecyclePhaseValues` fails here instead of silently
 * changing every operator's list.
 */
import {
  ORDER_LIFECYCLE_PHASE_PRECEDENCE,
  OrderLifecyclePhaseValues,
  type OrderLifecyclePhase,
} from '../types/order-lifecycle-phase.types';
import {
  deriveOrderLifecyclePhase,
  type DeriveOrderLifecyclePhaseInput,
} from './derive-order-lifecycle-phase';

const quiet: DeriveOrderLifecyclePhaseInput = {
  cancelledAt: null,
  fulfillmentState: null,
  activeHoldReason: null,
  hasOpenAmendment: false,
  recordStatus: 'ready',
  authority: { mode: 'openlinker' },
  vendorDeclaredPhase: null,
};

/** The facts that, on their own, produce each phase (posture A unless noted). */
const TRIGGER_BY_PHASE: Record<
  OrderLifecyclePhase,
  Partial<DeriveOrderLifecyclePhaseInput>
> = {
  cancelled: { cancelledAt: new Date('2026-01-01T00:00:00.000Z') },
  vendor_authoritative: {
    authority: { mode: 'external', connectionId: 'conn-1' },
    vendorDeclaredPhase: null,
  },
  delivered: { fulfillmentState: 'delivered' },
  in_transit: { fulfillmentState: 'dispatched' },
  fulfillment_failed: { fulfillmentState: 'failed' },
  held: { activeHoldReason: 'operator' },
  amending: { hasOpenAmendment: true },
  blocked: { recordStatus: 'awaiting_mapping' },
  ready: {},
};

describe('deriveOrderLifecyclePhase', () => {
  describe('single-fact derivation', () => {
    it.each(OrderLifecyclePhaseValues.map((phase) => [phase] as const))(
      'should derive %s when only that phase’s trigger is set',
      (phase) => {
        expect(
          deriveOrderLifecyclePhase({ ...quiet, ...TRIGGER_BY_PHASE[phase] }),
        ).toBe(phase);
      },
    );

    it('should cover every declared phase, so none becomes unreachable', () => {
      const derived = new Set(
        OrderLifecyclePhaseValues.map((phase) =>
          deriveOrderLifecyclePhase({ ...quiet, ...TRIGGER_BY_PHASE[phase] }),
        ),
      );

      expect(derived).toEqual(new Set(OrderLifecyclePhaseValues));
    });
  });

  describe('precedence (highest wins)', () => {
    const adjacentPairs = OrderLifecyclePhaseValues.slice(0, -1).map(
      (higher, index) => [higher, OrderLifecyclePhaseValues[index + 1]] as const,
    );

    it.each(adjacentPairs)(
      'should derive %s over %s when both triggers are set',
      (higher, lower) => {
        expect(ORDER_LIFECYCLE_PHASE_PRECEDENCE[higher]).toBeLessThan(
          ORDER_LIFECYCLE_PHASE_PRECEDENCE[lower],
        );

        expect(
          deriveOrderLifecyclePhase({
            ...quiet,
            ...TRIGGER_BY_PHASE[lower],
            ...TRIGGER_BY_PHASE[higher],
          }),
        ).toBe(higher);
      },
    );

    it('should derive cancelled over a dispatched shipment', () => {
      expect(
        deriveOrderLifecyclePhase({
          ...quiet,
          cancelledAt: new Date('2026-01-01T00:00:00.000Z'),
          fulfillmentState: 'dispatched',
        }),
      ).toBe('cancelled');
    });

    it('should derive cancelled over a delivered shipment', () => {
      expect(
        deriveOrderLifecyclePhase({
          ...quiet,
          cancelledAt: new Date('2026-01-01T00:00:00.000Z'),
          fulfillmentState: 'delivered',
        }),
      ).toBe('cancelled');
    });

    it('should derive held over amending, because a hold is a decision', () => {
      expect(
        deriveOrderLifecyclePhase({
          ...quiet,
          activeHoldReason: 'payment-review',
          hasOpenAmendment: true,
        }),
      ).toBe('held');
    });

    it('should derive cancelled when every input is hot at once', () => {
      expect(
        deriveOrderLifecyclePhase({
          cancelledAt: new Date('2026-01-01T00:00:00.000Z'),
          fulfillmentState: 'delivered',
          activeHoldReason: 'fraud-review',
          hasOpenAmendment: true,
          recordStatus: 'source_deleted',
          authority: { mode: 'external', connectionId: 'conn-1' },
          vendorDeclaredPhase: 'ready',
        }),
      ).toBe('cancelled');
    });
  });

  describe('residual and ingest gaps', () => {
    it('should derive ready when nothing applies', () => {
      expect(deriveOrderLifecyclePhase(quiet)).toBe('ready');
    });

    it.each(['awaiting_mapping', 'source_deleted'] as const)(
      'should derive blocked when recordStatus is %s',
      (recordStatus) => {
        expect(deriveOrderLifecyclePhase({ ...quiet, recordStatus })).toBe(
          'blocked',
        );
      },
    );
  });

  describe('null fulfillmentState parity', () => {
    it('should treat null identically to not-shipped', () => {
      const withNull = deriveOrderLifecyclePhase({
        ...quiet,
        fulfillmentState: null,
      });
      const withNotShipped = deriveOrderLifecyclePhase({
        ...quiet,
        fulfillmentState: 'not-shipped',
      });

      expect(withNull).toBe(withNotShipped);
      expect(withNull).toBe('ready');
    });
  });

  describe('posture B (external lifecycle authority)', () => {
    const external: DeriveOrderLifecyclePhaseInput = {
      ...quiet,
      authority: { mode: 'external', connectionId: 'conn-1' },
    };

    it('should derive vendor_authoritative when the vendor declared nothing classifiable', () => {
      expect(
        deriveOrderLifecyclePhase({ ...external, vendorDeclaredPhase: null }),
      ).toBe('vendor_authoritative');
    });

    it.each(OrderLifecyclePhaseValues.map((phase) => [phase] as const))(
      'should return the vendor-declared %s verbatim',
      (phase) => {
        expect(
          deriveOrderLifecyclePhase({
            ...external,
            vendorDeclaredPhase: phase,
          }),
        ).toBe(phase);
      },
    );

    it('should not re-derive from OL facts when the vendor declared a phase', () => {
      expect(
        deriveOrderLifecyclePhase({
          ...external,
          fulfillmentState: 'delivered',
          activeHoldReason: 'operator',
          recordStatus: 'source_deleted',
          vendorDeclaredPhase: 'ready',
        }),
      ).toBe('ready');
    });

    it('should still derive cancelled when OL recorded a cancellation', () => {
      expect(
        deriveOrderLifecyclePhase({
          ...external,
          cancelledAt: new Date('2026-01-01T00:00:00.000Z'),
          vendorDeclaredPhase: 'delivered',
        }),
      ).toBe('cancelled');
    });
  });

  describe('purity', () => {
    it('should not mutate its argument and should be clock-free', () => {
      const input = Object.freeze({
        ...quiet,
        fulfillmentState: 'dispatched',
      }) as DeriveOrderLifecyclePhaseInput;

      const first = deriveOrderLifecyclePhase(input);
      const second = deriveOrderLifecyclePhase(input);

      expect(first).toBe(second);
      expect(input).toEqual({ ...quiet, fulfillmentState: 'dispatched' });
    });
  });
});
