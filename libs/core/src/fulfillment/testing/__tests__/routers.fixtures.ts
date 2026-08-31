/**
 * Contract fixtures — one conforming router, and one deliberate breakage per
 * declared contract case (#2404, `W3a-15`)
 *
 * These exist to answer the only question that makes a contract suite worth
 * anything: **can it fail?** A suite verified solely against a conforming
 * subject is indistinguishable from a suite that asserts nothing — #2673's
 * "not found" and "pending" collapsing into one green reading, one level up.
 *
 * `NON_CONFORMING_ROUTERS` is keyed by the case id each fixture targets, and
 * `contract-coverage.spec.ts` asserts that key set EQUALS
 * `FULFILLMENT_ROUTER_CONTRACT_CASE_IDS`. So a case added to the suite without a
 * fixture proving it can fail is a build failure, not a silently uncovered rule.
 *
 * ## `expectedCollateral`
 *
 * Each fixture declares the OTHER cases its breakage necessarily also fails, and
 * the spec asserts the failing set is exactly `[target, ...expectedCollateral]`.
 * Declaring collateral is stricter than tolerating it: "at least the target
 * failed" would pass a fixture that broke everything, which proves nothing about
 * the target rule. Only one fixture has any, and it is inherent — an
 * unrecognised plan status leaves every plan-consuming case with no plan to
 * consume, which those cases correctly report.
 *
 * ## Why these are hand-written rather than generated
 *
 * A generated mutant proves the checker reacts to a perturbation; a hand-written
 * one proves it reacts to *the defect the rule is about*. `InventedResolutionRouter`
 * keeps the quantity totals balanced precisely so its failure is attributable to
 * the resolution value alone and not to conservation — that attribution is the
 * whole content of "fails its own case and no other".
 *
 * @module libs/core/src/fulfillment/testing/__tests__
 */
import type { FulfillmentRouterPort } from '../../domain/ports/fulfillment-router.port';
import type {
  ResolvedRoutingPlan,
  RoutingEvaluation,
  RoutingInput,
  RoutingPlan,
} from '../../domain/types/routing.types';
import type { FulfillmentRouterContractCaseId } from '../fulfillment-router-contract.suite';
import { FULFILLMENT_ROUTER_CONTRACT_INPUT } from '../fulfillment-router-contract.suite';

const STEP = {
  rule: { ruleId: 'rule-1', name: 'nearest-location', displayLabel: 'Nearest location' },
  eliminated: [],
  score: 1,
  detail: null,
} as const;

function assignmentsFor(input: RoutingInput): ResolvedRoutingPlan['assignments'] {
  return input.lines.map((line) => ({
    orderLineId: line.orderLineId,
    locationId: 'loc-1',
    connectionId: null,
    deliveryMethod: null,
    quantity: line.quantity,
  }));
}

/** A router that satisfies every declared rule. */
export class ConformingRouter implements FulfillmentRouterPort {
  evaluate(input: RoutingInput): Promise<RoutingEvaluation> {
    return Promise.resolve({
      candidates: assignmentsFor(input),
      unfulfillable: [],
      explanation: [STEP],
    });
  }

  route(input: RoutingInput): Promise<RoutingPlan> {
    return Promise.resolve({
      status: 'resolved',
      decisionId: 'decision-1',
      assignments: assignmentsFor(input),
      unfulfillable: [],
      holds: [],
      explanation: [STEP],
    });
  }
}

/** Varies the plan BODY between calls carrying the same idempotency key. */
class UnstableUnderRepeatedKeyRouter extends ConformingRouter {
  private calls = 0;

  override route(input: RoutingInput): Promise<RoutingPlan> {
    // Quantities are preserved, so conservation still holds — only the body
    // differs. A fixture that also broke conservation would prove nothing about
    // the idempotency rule.
    this.calls += 1;
    return Promise.resolve({
      status: 'resolved',
      decisionId: 'decision-1',
      assignments: assignmentsFor(input).map((a) => ({
        ...a,
        locationId: `loc-${this.calls}`,
      })),
      unfulfillable: [],
      holds: [],
      explanation: [STEP],
    });
  }
}

/** Silently drops a line — unfulfilled stock, every surface reporting success. */
class DropsALineRouter extends ConformingRouter {
  override route(input: RoutingInput): Promise<RoutingPlan> {
    return Promise.resolve({
      status: 'resolved',
      decisionId: 'decision-1',
      assignments: assignmentsFor(input).slice(0, 1),
      unfulfillable: [],
      holds: [],
      explanation: [STEP],
    });
  }
}

/** Invents a third resolution outside the closed two-member union. */
class InventedResolutionRouter extends ConformingRouter {
  override route(input: RoutingInput): Promise<RoutingPlan> {
    const [first, ...rest] = input.lines;
    return Promise.resolve({
      status: 'resolved',
      decisionId: 'decision-1',
      // Totals still balance, so `route/conserves-quantities` stays green and
      // the failure is attributable to the resolution value alone.
      assignments: assignmentsFor({ ...input, lines: rest }),
      unfulfillable: [
        {
          orderLineId: first.orderLineId,
          quantity: first.quantity,
          resolution: 'partial-cancel' as unknown as 'refund',
          reason: 'invented',
        },
      ],
      holds: [],
      explanation: [STEP],
    });
  }
}

/** An explanation step an operator cannot act on. */
class UnlabelledExplanationRouter extends ConformingRouter {
  override route(input: RoutingInput): Promise<RoutingPlan> {
    return Promise.resolve({
      status: 'resolved',
      decisionId: 'decision-1',
      assignments: assignmentsFor(input),
      unfulfillable: [],
      holds: [],
      explanation: [{ ...STEP, rule: { ...STEP.rule, displayLabel: '' } }],
    });
  }
}

/** Answers with a status this build has no reading for. */
class UnrecognisedStatusRouter extends ConformingRouter {
  override route(): Promise<RoutingPlan> {
    return Promise.resolve({
      status: 'queued',
      decisionId: 'decision-1',
    } as unknown as RoutingPlan);
  }
}

/** Leaks a committing identifier onto the non-committing path. */
class CommittingEvaluateRouter extends ConformingRouter {
  override evaluate(input: RoutingInput): Promise<RoutingEvaluation> {
    return super
      .evaluate(input)
      .then((base) => ({ ...base, decisionId: 'decision-1' }) as unknown as RoutingEvaluation);
  }
}

/** Names an order line the caller never sent. */
class InventsALineRouter extends ConformingRouter {
  override evaluate(input: RoutingInput): Promise<RoutingEvaluation> {
    return super.evaluate(input).then((base) => ({
      ...base,
      candidates: [
        ...base.candidates,
        {
          orderLineId: 'line-999',
          locationId: 'loc-1',
          connectionId: null,
          deliveryMethod: null,
          quantity: 1,
        },
      ],
    }));
  }
}

/** Treats the caller's input as its own. */
class MutatesInputRouter extends ConformingRouter {
  override evaluate(input: RoutingInput): Promise<RoutingEvaluation> {
    try {
      (input.lines[0] as { quantity: number }).quantity += 1;
    } catch {
      // Every other case passes a FROZEN input, where this throws. Swallowing
      // keeps the breakage confined to the one case that hands over a mutable
      // copy, so this fixture has no collateral.
    }
    return super.evaluate(input);
  }
}

/** Rejects an order because core grew a field it does not know. */
class RejectsUnknownFieldRouter extends ConformingRouter {
  override evaluate(input: RoutingInput): Promise<RoutingEvaluation> {
    const known = new Set(['orderId', 'lines', 'shipTo', 'requestedDeliveryMethod']);
    for (const key of Object.keys(input)) {
      if (!known.has(key)) {
        throw new Error(`unknown RoutingInput field: ${key}`);
      }
    }
    return super.evaluate(input);
  }
}

export interface NonConformingFixture {
  readonly make: () => FulfillmentRouterPort;
  readonly expectedCollateral: readonly FulfillmentRouterContractCaseId[];
}

export const NON_CONFORMING_ROUTERS: Record<
  FulfillmentRouterContractCaseId,
  NonConformingFixture
> = {
  'route/requires-idempotency-key': {
    make: () => new UnstableUnderRepeatedKeyRouter(),
    expectedCollateral: [],
  },
  'route/conserves-quantities': {
    make: () => new DropsALineRouter(),
    expectedCollateral: [],
  },
  'route/unfulfillable-resolution-closed': {
    make: () => new InventedResolutionRouter(),
    expectedCollateral: [],
  },
  'route/explanation-steps-well-formed': {
    make: () => new UnlabelledExplanationRouter(),
    expectedCollateral: [],
  },
  'route/plan-status-recognised': {
    make: () => new UnrecognisedStatusRouter(),
    // Inherent: with no consumable plan, every plan-reading case correctly
    // reports that it could not proceed. Declared exactly rather than tolerated.
    expectedCollateral: [
      'route/requires-idempotency-key',
      'route/conserves-quantities',
      'route/unfulfillable-resolution-closed',
      'route/explanation-steps-well-formed',
    ],
  },
  'evaluate/no-committing-identifier': {
    make: () => new CommittingEvaluateRouter(),
    expectedCollateral: [],
  },
  'evaluate/candidates-name-known-lines': {
    make: () => new InventsALineRouter(),
    expectedCollateral: [],
  },
  'evaluate/does-not-mutate-input': {
    make: () => new MutatesInputRouter(),
    expectedCollateral: [],
  },
  'input/unknown-fields-ignored': {
    make: () => new RejectsUnknownFieldRouter(),
    expectedCollateral: [],
  },
};

export { FULFILLMENT_ROUTER_CONTRACT_INPUT };
