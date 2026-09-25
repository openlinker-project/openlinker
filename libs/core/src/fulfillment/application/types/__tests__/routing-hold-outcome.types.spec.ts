/**
 * Routing hold outcome — unit tests (#3485)
 *
 * One case per row of the mapping table in the implementation plan, plus the
 * runtime guard against an outcome this build does not understand.
 */
import { deriveRoutingHoldOutcome } from '../routing-hold-outcome.types';
import type { RoutingCommitOutcome } from '../routing-commit.types';

describe('deriveRoutingHoldOutcome', () => {
  it('should hold a routed order with no block and clear the line attention', () => {
    const result = deriveRoutingHoldOutcome({
      status: 'routed',
      decisionId: 'dec-1',
      works: [{ workId: 'w-1', assignedConnectionId: 'holder-1' }],
    });

    expect(result).toEqual({ held: true, block: null, lineAttention: { kind: 'none' } });
  });

  it('should hold an in-doubt order and leave the line attention untouched', () => {
    const result = deriveRoutingHoldOutcome({
      status: 'in-doubt',
      decisionId: 'dec-1',
      cause: 'timeout',
    });

    expect(result.held).toBe(true);
    expect(result.block?.reason).toBe('routing-in-doubt');
    expect(result.block?.detail).toContain('dec-1');
    expect(result.lineAttention).toEqual({ kind: 'indeterminate' });
  });

  it('should hold a contended order and leave the line attention untouched', () => {
    expect(deriveRoutingHoldOutcome({ status: 'contended' })).toEqual({
      held: true,
      block: { reason: 'routing-contended', detail: null },
      lineAttention: { kind: 'indeterminate' },
    });
  });

  it.each(['already-routed', 'already-live-elsewhere'] as const)(
    'should hold an order the #2047 guard refused (%s)',
    (reason) => {
      const result = deriveRoutingHoldOutcome({ status: 'skipped', reason });

      expect(result.held).toBe(true);
      expect(result.block).toEqual({
        reason: 'routing-already-live-elsewhere',
        detail: `routing refused: ${reason}`,
      });
      expect(result.lineAttention).toEqual({ kind: 'indeterminate' });
    }
  );

  it('should not hold a cancelled order and should clear the line attention', () => {
    expect(deriveRoutingHoldOutcome({ status: 'skipped', reason: 'order-cancelled' })).toEqual({
      held: false,
      block: null,
      lineAttention: { kind: 'none' },
    });
  });

  // The case #3485 exists for: out of stock at every location. Held, named, and
  // raised as UF-L so it counts in "Needs attention".
  it('should hold a refused order and raise line-unfulfillable when the plan carried unfulfillable lines', () => {
    const result = deriveRoutingHoldOutcome({
      status: 'refused',
      decisionId: 'dec-9',
      reason: 'plan-carries-unfulfillable',
    });

    expect(result.held).toBe(true);
    expect(result.block).toEqual({
      reason: 'routing-refused',
      detail: 'plan-carries-unfulfillable',
    });
    expect(result.lineAttention).toEqual({ kind: 'blocked', reason: 'line-unfulfillable' });
  });

  // A re-route mints a new decision id each tick; a detail carrying it would
  // defeat the IS DISTINCT FROM guards and bump updatedAt on every tick.
  it('should report the same block and attention for two refusals under different decisions', () => {
    const first = deriveRoutingHoldOutcome({
      status: 'refused',
      decisionId: 'dec-1',
      reason: 'plan-carries-unfulfillable',
    });
    const second = deriveRoutingHoldOutcome({
      status: 'refused',
      decisionId: 'dec-2',
      reason: 'plan-carries-unfulfillable',
    });

    expect(second).toEqual(first);
  });

  it.each(['plan-pending', 'plan-not-conserving', 'plan-carries-holds'] as const)(
    'should hold a refused order without raising line-unfulfillable (%s)',
    (reason) => {
      const result = deriveRoutingHoldOutcome({ status: 'refused', decisionId: 'dec-9', reason });

      expect(result.held).toBe(true);
      expect(result.block?.reason).toBe('routing-refused');
      expect(result.lineAttention).toEqual({ kind: 'none' });
    }
  );

  it('should throw for an outcome this build does not recognise rather than report it not held', () => {
    const unknown = { status: 'teleported' } as unknown as RoutingCommitOutcome;

    expect(() => deriveRoutingHoldOutcome(unknown)).toThrow('Unrecognised routing commit outcome');
  });
});
