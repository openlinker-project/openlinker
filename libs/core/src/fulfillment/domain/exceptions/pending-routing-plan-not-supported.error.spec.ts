import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { PendingRoutingPlan, ResolvedRoutingPlan, RoutingPlan } from '../types/routing.types';

import {
  assertRoutingPlanResolved,
  PendingRoutingPlanNotSupportedError,
  UnrecognisedRoutingPlanStatusError,
} from './pending-routing-plan-not-supported.error';

describe('assertRoutingPlanResolved', () => {
  const resolved: ResolvedRoutingPlan = {
    status: 'resolved',
    decisionId: 'decision-1',
    assignments: [],
    unfulfillable: [],
    holds: [],
    explanation: [],
  };

  const pending: PendingRoutingPlan = { status: 'pending', decisionId: 'decision-2' };

  it('should reject a pending plan with a named error carrying the decision id', () => {
    expect(() => assertRoutingPlanResolved(pending)).toThrow(PendingRoutingPlanNotSupportedError);

    try {
      assertRoutingPlanResolved(pending);
      throw new Error('expected a rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(PendingRoutingPlanNotSupportedError);
      expect((error as PendingRoutingPlanNotSupportedError).decisionId).toBe('decision-2');
      expect((error as Error).name).toBe('PendingRoutingPlanNotSupportedError');
    }
  });

  /**
   * A plan crosses this boundary from a plugin, and core validates nothing a
   * plugin returns — so an unknown status must fail closed rather than be
   * narrowed into a resolved plan with nothing in it.
   */
  it('should refuse an unrecognised status rather than narrowing it to resolved', () => {
    const rogue = { status: 'queued', decisionId: 'decision-3' } as unknown as RoutingPlan;

    expect(() => assertRoutingPlanResolved(rogue)).toThrow(UnrecognisedRoutingPlanStatusError);

    try {
      assertRoutingPlanResolved(rogue);
      throw new Error('expected a rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(UnrecognisedRoutingPlanStatusError);
      expect((error as UnrecognisedRoutingPlanStatusError).status).toBe('queued');
    }
  });

  it('should narrow a resolved plan without throwing', () => {
    expect(() => assertRoutingPlanResolved(resolved)).not.toThrow();

    const plan = resolved as ResolvedRoutingPlan | PendingRoutingPlan;
    assertRoutingPlanResolved(plan);
    expect(plan.assignments).toEqual([]);
  });
});

describe('FulfillmentRouterPort contract', () => {
  const portSource = readFileSync(
    join(__dirname, '..', 'ports', 'fulfillment-router.port.ts'),
    'utf8',
  );
  const withoutComments = portSource.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');

  /**
   * Cheap defence in depth rather than the proof: a repository or service import
   * here would already fail `barrel-purity.spec.ts` and
   * `check-no-injection-contracts.mjs`. The load-bearing guarantee is the
   * compile-time absence of `decisionId` from `RoutingEvaluation` (asserted in
   * `routing.types.spec.ts`) plus `evaluate` taking no `RouteOptions` below —
   * core cannot constrain what a third-party router does inside `evaluate()`.
   */
  it('should reach no write seam from the port declaration', () => {
    expect(withoutComments).not.toContain('RepositoryPort');
    expect(withoutComments).not.toContain('ModuleRef');
    expect(withoutComments).not.toContain('_TOKEN');
  });

  it('should give evaluate no options argument, so it cannot be handed a committing key', () => {
    expect(withoutComments).toContain('evaluate(input: RoutingInput): Promise<RoutingEvaluation>');
    expect(withoutComments).toContain('route(input: RoutingInput, options: RouteOptions)');
  });

  it('should not advertise FulfillmentRouter as a registry capability', () => {
    expect(withoutComments).not.toContain("'FulfillmentRouter'");
    expect(withoutComments).not.toContain('supportedCapabilities');
  });
});
