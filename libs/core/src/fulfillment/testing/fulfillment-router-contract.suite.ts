/**
 * `FulfillmentRouterPort` contract suite (#2404, `W3a-15`)
 *
 * One suite every `FulfillmentRouterPort` implementation must pass. Design §9
 * asks for contract symmetry enforced this way so the seam gets **two-implementer
 * honesty before a second implementer exists** — the first implementer is bound
 * to the contract, rather than the contract quietly becoming whatever the first
 * implementer happened to do.
 *
 * ## Shape: a PURE checker plus a thin jest wrapper
 *
 * `checkFulfillmentRouterContract` holds every rule, names no jest global, and
 * answers in `ContractRunResult`. `runFulfillmentRouterContract` is the ~20-line
 * jest entry point, matching `runKsefHttpClientContract` /
 * `runSubiektBridgeContractTests`.
 *
 * The split is deliberate and is the point of #2404. Both shipped suites are
 * jest-coupled throughout, so neither can answer **"did this suite actually
 * assert anything?"** from outside jest — and a contract kit is exactly the
 * machinery that can look thorough and assert nothing (#2673, #2589, and #2393's
 * `keyof (A | B)` guard that was vacuous by construction). With the rules in a
 * pure function, "a non-conforming router fails" and "every case is actually
 * covered" become ordinary unit tests. See `__tests__/`.
 *
 * ## Every rule cites the declaration that supports it
 *
 * A rule with no source in `libs/core` is NOT shipped, because a mirror stricter
 * than the gate refuses work the destination would have accepted (#2240). Seven
 * candidate rules were dropped on that basis — including two the issue text
 * names. The reasons are recorded in
 * `docs/plans/implementation-plan-port-contract-test-kit.md` §5 and summarised
 * per case below.
 *
 * ## Not asserted here, with reasons
 *
 * - **`decisionId` stability under a repeated idempotency key.** The port states
 *   the key's PROVENANCE and ordering ("derived from the routing-decision row
 *   the caller persists before this call"), not a return-value guarantee. A
 *   stateless router is legal and is handed no store by this suite, so
 *   asserting identical ids would fail a conforming implementation. Narrowed to
 *   plan-BODY equivalence, which a deterministic router satisfies without
 *   persistence. Tightening it needs a port amendment.
 * - **`holds[].reason` membership of `HoldReasonValues`.** Needs a VALUE import
 *   of `@openlinker/core/order-lifecycle`; `barrel-purity.spec.ts` authorises
 *   this leaf's cross-context specifiers type-only. `RoutingHold.reason` is
 *   typed `HoldReason`, so it is compile-time-enforced for any TypeScript
 *   implementer, and holds stay covered for QUANTITY by
 *   `route/conserves-quantities`.
 * - **`blocking` exclusion.** Named in the issue; this port has no `blocking`
 *   concept.
 * - **Declared-timeout respect.** The port defers wall-clock budgets to `W4-1` /
 *   `W4-2`. There is no declared timeout, and a wall-clock rule would be a flaky
 *   test measuring nothing.
 * - **`ROUTING_INPUT_FORBIDDEN_KEYS` tolerance.** Near-tautological, and it
 *   points the wrong way: that constant constrains what CORE SENDS, so the
 *   useful assertion belongs on the caller (#2395).
 *
 * @module libs/core/src/fulfillment/testing
 * @see docs/plans/implementation-plan-port-contract-test-kit.md
 */
import { assertRoutingPlanResolved } from '../domain/exceptions/pending-routing-plan-not-supported.error';
import type { FulfillmentRouterPort } from '../domain/ports/fulfillment-router.port';
import type {
  ResolvedRoutingPlan,
  RoutingEvaluation,
  RoutingInput,
  RoutingPlan,
} from '../domain/types/routing.types';
import {
  RoutingUnfulfillableResolutionValues,
  checkRoutingPlanConservesQuantities,
} from '../domain/types/routing.types';
import type {
  ContractCaseRecorder,
  ContractCaseResult,
  ContractRunResult,
} from './contract-result.types';
import {
  ContractSubjectMissingError,
  EmptyContractSuiteError,
} from './contract-result.types';

const CONTRACT_NAME = 'FulfillmentRouterPort contract';

/**
 * The declared case table.
 *
 * `__tests__/contract-coverage.spec.ts` asserts this set equals the set of case
 * ids the non-conformance fixtures target, failing on EITHER side. That equality
 * is the primary anti-vacuity guard: without it, a case could be added here with
 * no fixture proving it can fail, and the suite would stay green while covering
 * nothing — "declared" and "covered" collapsing into one reading, the #2673
 * shape.
 */
export const FULFILLMENT_ROUTER_CONTRACT_CASE_IDS = [
  'route/requires-idempotency-key',
  'route/conserves-quantities',
  'route/unfulfillable-resolution-closed',
  'route/explanation-steps-well-formed',
  'route/plan-status-recognised',
  'evaluate/no-committing-identifier',
  'evaluate/candidates-name-known-lines',
  'evaluate/does-not-mutate-input',
  'input/unknown-fields-ignored',
] as const;

export type FulfillmentRouterContractCaseId =
  (typeof FULFILLMENT_ROUTER_CONTRACT_CASE_IDS)[number];

/** The input every case routes, unless it needs a variant of it. */
export const FULFILLMENT_ROUTER_CONTRACT_INPUT: RoutingInput = Object.freeze({
  orderId: 'ol_order_contract_fixture',
  lines: Object.freeze([
    Object.freeze({
      orderLineId: 'line-1',
      productVariantId: 'ol_variant_contract_1',
      quantity: 2,
    }),
    Object.freeze({
      orderLineId: 'line-2',
      productVariantId: 'ol_variant_contract_2',
      quantity: 1,
    }),
  ]),
  shipTo: Object.freeze({
    mode: 'plain' as const,
    countryIso2: 'PL',
    postalCode: '00-001',
    city: 'Warszawa',
  }),
  requestedDeliveryMethod: null,
}) as RoutingInput;

const IDEMPOTENCY_KEY = 'contract-decision-0001';

interface MutableCaseResult {
  id: FulfillmentRouterContractCaseId;
  checks: number;
  failures: string[];
}

function createRecorder(into: MutableCaseResult): ContractCaseRecorder {
  return {
    check(condition: boolean, failureMessage: string): void {
      into.checks += 1;
      if (!condition) {
        into.failures.push(failureMessage);
      }
    },
  };
}

/** The body of one contract case. */
type ContractCase = (
  router: FulfillmentRouterPort,
  record: ContractCaseRecorder,
) => Promise<void>;

/**
 * Structural comparison of the parts of a plan a repeated idempotency key must
 * not change. Deliberately excludes `decisionId` — see the file docblock.
 */
function planBody(plan: ResolvedRoutingPlan): string {
  return JSON.stringify({
    assignments: plan.assignments,
    unfulfillable: plan.unfulfillable,
    holds: plan.holds,
  });
}

/**
 * Route and narrow, attributing a non-resolved answer to the calling case.
 *
 * A `pending` router is refused by this build (`W4-3`), so a case needing a
 * resolved plan records a FAILURE rather than skipping. Nothing in this suite
 * skips: a skip is how a suite reports nothing and still reads green.
 */
async function routeResolved(
  router: FulfillmentRouterPort,
  record: ContractCaseRecorder,
  input: RoutingInput = FULFILLMENT_ROUTER_CONTRACT_INPUT,
): Promise<ResolvedRoutingPlan | null> {
  const plan: RoutingPlan = await router.route(input, {
    idempotencyKey: IDEMPOTENCY_KEY,
  });
  try {
    assertRoutingPlanResolved(plan);
    return plan;
  } catch (error) {
    record.check(
      false,
      `route() did not return a plan this build can consume: ${(error as Error).message}`,
    );
    return null;
  }
}

const CONTRACT_CASES: Record<FulfillmentRouterContractCaseId, ContractCase> = {
  /**
   * SOURCE: the port docblock — `options.idempotencyKey` is REQUIRED and is
   * derived from the routing-decision row the caller persists before the call.
   * Asserts the key is ACCEPTED and that repeating it does not change the plan
   * BODY. Not `decisionId` equality; see the file docblock.
   */
  'route/requires-idempotency-key': async (router, record) => {
    const first = await routeResolved(router, record);
    const second = await routeResolved(router, record);
    if (!first || !second) {
      return;
    }
    record.check(
      planBody(first) === planBody(second),
      'route() returned a different plan body for a repeated idempotencyKey ' +
        `(${planBody(first)} vs ${planBody(second)})`,
    );
  },

  /**
   * SOURCE: `checkRoutingPlanConservesQuantities` in `routing.types.ts` — "a
   * plan that silently drops a line is unfulfilled stock with every surface
   * reporting success", the failure nothing downstream can detect on its own.
   */
  'route/conserves-quantities': async (router, record) => {
    const plan = await routeResolved(router, record);
    if (!plan) {
      return;
    }
    record.check(
      checkRoutingPlanConservesQuantities(FULFILLMENT_ROUTER_CONTRACT_INPUT, plan),
      'route() returned a plan that does not account for every requested unit ' +
        '(assigned + unfulfillable + held must equal the input quantity per line, ' +
        'and no line may be named that the input did not)',
    );
  },

  /**
   * SOURCE: `RoutingUnfulfillableResolutionValues` is closed at two members
   * (DESIGN §5.3(a)) — a partial-cancel state would be an invention no source
   * can express.
   */
  'route/unfulfillable-resolution-closed': async (router, record) => {
    const plan = await routeResolved(router, record);
    if (!plan) {
      return;
    }
    record.check(
      plan.unfulfillable.every((line) =>
        (RoutingUnfulfillableResolutionValues as readonly string[]).includes(line.resolution),
      ),
      'route() returned an unfulfillable line whose resolution is outside ' +
        `RoutingUnfulfillableResolutionValues (${RoutingUnfulfillableResolutionValues.join(', ')})`,
    );
  },

  /**
   * SOURCE: `RoutingExplanationStep`'s field types. Asserts WELL-FORMEDNESS of
   * every step present, never a minimum count — the port declares no cardinality
   * and a single trivial assignment legitimately explains nothing.
   */
  'route/explanation-steps-well-formed': async (router, record) => {
    const plan = await routeResolved(router, record);
    if (!plan) {
      return;
    }
    record.check(
      plan.explanation.every(
        (step) =>
          typeof step.rule?.ruleId === 'string' &&
          step.rule.ruleId.length > 0 &&
          typeof step.rule.name === 'string' &&
          step.rule.name.length > 0 &&
          typeof step.rule.displayLabel === 'string' &&
          step.rule.displayLabel.length > 0,
      ),
      'route() returned an explanation step whose rule is missing a non-empty ' +
        'ruleId, name or displayLabel — an operator cannot act on it',
    );
  },

  /**
   * SOURCE: `pending-routing-plan-not-supported.error.ts`. The ROUTER-facing
   * half only: the status must be an arm this build recognises. The behaviour of
   * `assertRoutingPlanResolved` itself is owned by that file's own spec.
   */
  'route/plan-status-recognised': async (router, record) => {
    const plan: RoutingPlan = await router.route(FULFILLMENT_ROUTER_CONTRACT_INPUT, {
      idempotencyKey: IDEMPOTENCY_KEY,
    });
    record.check(
      plan.status === 'resolved' || plan.status === 'pending',
      `route() returned an unrecognised plan status: ${JSON.stringify(
        (plan as { status: unknown }).status,
      )}`,
    );
  },

  /**
   * SOURCE: the port §(b) — `RoutingEvaluation` carries no `decisionId`, so no
   * caller can persist a decision off an evaluate result. **The ABSENCE is the
   * contract**, which is why this is asserted at runtime and not left to types:
   * a plugin returning an extra field type-checks fine against a structural
   * interface.
   */
  'evaluate/no-committing-identifier': async (router, record) => {
    const evaluation: RoutingEvaluation = await router.evaluate(
      FULFILLMENT_ROUTER_CONTRACT_INPUT,
    );
    const keys = Object.keys(evaluation);
    record.check(
      !keys.includes('decisionId'),
      'evaluate() returned a decisionId — the non-committing contract requires ' +
        'that no committing identifier travels on this path',
    );
    record.check(
      !keys.includes('holds'),
      'evaluate() returned holds — evaluate chooses nothing and may place nothing',
    );
  },

  /**
   * SOURCE: the `evaluate` half of the "must not invent a line" property that
   * `checkRoutingPlanConservesQuantities` gives `route`. `RoutingEvaluation` has
   * no conservation helper — candidates are ranked possibilities, so their
   * quantities need not sum — but naming a line the caller never sent is
   * incoherent on either path.
   */
  'evaluate/candidates-name-known-lines': async (router, record) => {
    const evaluation = await router.evaluate(FULFILLMENT_ROUTER_CONTRACT_INPUT);
    const known = new Set(FULFILLMENT_ROUTER_CONTRACT_INPUT.lines.map((l) => l.orderLineId));
    const named = [
      ...evaluation.candidates.map((c) => c.orderLineId),
      ...evaluation.unfulfillable.map((u) => u.orderLineId),
    ];
    const invented = named.filter((id) => !known.has(id));
    record.check(
      invented.length === 0,
      `evaluate() named order lines the input did not contain: ${invented.join(', ')}`,
    );
  },

  /**
   * SOURCE: every `RoutingInput` field is `readonly` and `lines` is
   * `readonly RoutingInputLine[]`. A plugin does not own the caller's object.
   */
  'evaluate/does-not-mutate-input': async (router, record) => {
    const input: RoutingInput = {
      orderId: FULFILLMENT_ROUTER_CONTRACT_INPUT.orderId,
      lines: FULFILLMENT_ROUTER_CONTRACT_INPUT.lines.map((line) => ({ ...line })),
      shipTo: { ...FULFILLMENT_ROUTER_CONTRACT_INPUT.shipTo },
      requestedDeliveryMethod: FULFILLMENT_ROUTER_CONTRACT_INPUT.requestedDeliveryMethod,
    };
    const before = JSON.stringify(input);
    await router.evaluate(input);
    record.check(
      JSON.stringify(input) === before,
      'evaluate() mutated the RoutingInput it was given ' +
        `(${before} became ${JSON.stringify(input)})`,
    );
  },

  /**
   * SOURCE: ADR-055 forward-compat — core may grow a `RoutingInput` field, and
   * an older plugin must keep answering rather than rejecting the whole order.
   */
  'input/unknown-fields-ignored': async (router, record) => {
    const widened = {
      ...FULFILLMENT_ROUTER_CONTRACT_INPUT,
      someFieldAddedByALaterCoreVersion: 'ignore me',
    } as RoutingInput;
    let answered = false;
    try {
      await router.evaluate(widened);
      answered = true;
    } catch {
      answered = false;
    }
    record.check(
      answered,
      'evaluate() threw when handed a RoutingInput carrying an unknown field — ' +
        'an added core field must not make an existing router reject the order',
    );
  },
};

/**
 * Run every contract rule against `router` and report per-case results.
 *
 * Pure of jest: names no `describe`, `it` or `expect`, so it is callable from
 * any runner and, more importantly, is itself testable.
 *
 * @throws ContractSubjectMissingError when there is nothing to test.
 * @throws EmptyContractSuiteError when the case table is empty.
 */
export async function checkFulfillmentRouterContract(
  router: FulfillmentRouterPort,
  options: { readonly subject?: string } = {},
): Promise<ContractRunResult> {
  if (router === null || router === undefined) {
    throw new ContractSubjectMissingError(CONTRACT_NAME, 'the factory produced no router');
  }
  if (typeof router.route !== 'function' || typeof router.evaluate !== 'function') {
    throw new ContractSubjectMissingError(
      CONTRACT_NAME,
      'the subject does not implement both route() and evaluate()',
    );
  }

  const caseIds = Object.keys(CONTRACT_CASES) as FulfillmentRouterContractCaseId[];
  if (caseIds.length === 0) {
    throw new EmptyContractSuiteError(CONTRACT_NAME);
  }

  const cases: ContractCaseResult[] = [];
  for (const id of caseIds) {
    const result: MutableCaseResult = { id, checks: 0, failures: [] };
    try {
      await CONTRACT_CASES[id](router, createRecorder(result));
    } catch (error) {
      // A throwing case is a FAILURE, never a silent pass. Swallowing here is
      // what would let a broken rule read green.
      result.failures.push(`case threw: ${(error as Error).message}`);
    }
    cases.push({ id: result.id, checks: result.checks, failures: result.failures });
  }

  return { subject: options.subject ?? router.constructor?.name ?? 'router', cases };
}

/**
 * Jest entry point — the `runKsefHttpClientContract` /
 * `runSubiektBridgeContractTests` shape.
 *
 * Uses ambient Jest globals (`describe` / `it` / `expect`); call it from inside
 * a spec file. Note what it does NOT do: it never skips. A case that could not
 * run is a failing `it`, because a skipped contract case and a passing one are
 * indistinguishable in a green report.
 */
export function runFulfillmentRouterContract(
  makeRouter: () => FulfillmentRouterPort,
  options: { readonly subject?: string } = {},
): void {
  describe(`${CONTRACT_NAME}${options.subject ? ` — ${options.subject}` : ''}`, () => {
    let result: ContractRunResult;

    beforeAll(async () => {
      // A throw here (missing subject, empty suite) fails the whole describe —
      // which is the intended hard failure, not an inconvenience.
      result = await checkFulfillmentRouterContract(makeRouter(), options);
    });

    it('runs every declared contract case', () => {
      expect(result.cases.map((c) => c.id).sort()).toEqual(
        [...FULFILLMENT_ROUTER_CONTRACT_CASE_IDS].sort(),
      );
    });

    for (const id of FULFILLMENT_ROUTER_CONTRACT_CASE_IDS) {
      it(id, () => {
        const found = result.cases.find((c) => c.id === id);
        expect(found).toBeDefined();
        expect(found?.failures ?? ['case did not run']).toEqual([]);
        expect(found?.checks ?? 0).toBeGreaterThan(0);
      });
    }
  });
}
