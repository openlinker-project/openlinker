/**
 * Pending routing plan — the named Wave-3a rejection (#2393, REVIEW G5)
 *
 * `RoutingPlan` carries a third `pending` arm so a genuinely asynchronous DOMS
 * (R1) has a shape to answer in. Wave 3a declares that arm and REFUSES it here;
 * consuming it is `W4-3`.
 *
 * Refusing loudly is the point. A `pending` plan treated as resolved would
 * proceed with no assignments, no unfulfillable lines and no holds — which is
 * indistinguishable from a router that considered the order and successfully
 * decided to create no work at all. The order would then sit unfulfilled with
 * every surface reporting success.
 *
 * `assertRoutingPlanResolved` lives here rather than beside the type it narrows
 * because the `engineering-standards.md` pure-rule exception is scoped to
 * `*.types.ts`, and the rule this function encodes is not a fact about
 * `RoutingPlan` — it is this build's REFUSAL of one of its arms. Co-locating the
 * assertion with the error it raises (the `is*`-guard-beside-its-capability
 * shape) keeps the refusal and its reason in one file; splitting them would let
 * a caller narrow without ever meeting the explanation.
 *
 * @module libs/core/src/fulfillment/domain/exceptions
 * @see docs/plans/analysis/REVIEW-oms-authority-model.md G5
 */
import type { ResolvedRoutingPlan, RoutingPlan } from '../types/routing.types';

/**
 * Raised when a router answers `pending` on a build that cannot consume it.
 *
 * Carries the `decisionId` because it is the only handle an operator has on the
 * in-flight decision the router is still working on.
 */
export class PendingRoutingPlanNotSupportedError extends Error {
  constructor(public readonly decisionId: string) {
    super(
      `Router returned a pending routing plan (decisionId: ${decisionId}). ` +
        'Asynchronous routing is declared but not consumed in this build (W4-3).',
    );
    this.name = 'PendingRoutingPlanNotSupportedError';
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Narrow a `RoutingPlan` to the arm this build can act on.
 *
 * Pure; the rule for the type it sits with. An assertion signature rather than a
 * boolean so a caller cannot read the result and carry on regardless.
 */
export function assertRoutingPlanResolved(plan: RoutingPlan): asserts plan is ResolvedRoutingPlan {
  if (plan.status === 'pending') {
    throw new PendingRoutingPlanNotSupportedError(plan.decisionId);
  }
}
