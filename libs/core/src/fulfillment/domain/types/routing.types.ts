/**
 * Routing I/O — what crosses `FulfillmentRouterPort` (#2393, DESIGN §5.3)
 *
 * Three properties of the design shape these types.
 *
 * **(a) The return type can say no.** `unfulfillable` lines resolve as
 * line-scoped refund or return — never an invented partial-cancel state no
 * source can express, which is why `RoutingUnfulfillableResolution` is closed
 * at two members.
 *
 * **(b) Dry run is first-class.** `RoutingEvaluation` is a separate type from
 * `RoutingPlan` rather than a flag on one, and it carries no `decisionId` — see
 * `fulfillment-router.port.ts` for why that absence is the contract.
 *
 * **(c) Rules are opaque across the port.** REVIEW H7 moves the closed named
 * filters and sorts, and their coercer, to `@openlinker/oms`: they configure
 * OpenLinker's own router and bind no vendor. Core keeps only `RoutingRuleRef`,
 * whose `name` is an arbitrary string carried with a display label, so a
 * vendor's own rule names render in the explanation an operator reads.
 *
 * ## No sibling-context import
 *
 * Every field here is a primitive or a shape declared in this leaf, so this
 * file adds nothing to the `fulfillment` allow-set in
 * `libs/core/src/__tests__/barrel-purity.spec.ts`. `orderId` is a plain
 * internal-id string for the same reason `FulfillmentWork.orderId` is: ADR-053's
 * no-injection invariant is cheap only while this context never needs order data
 * as a shape.
 *
 * @module libs/core/src/fulfillment/domain/types
 * @see docs/plans/analysis/DESIGN-oms-authority-model.md §5.3
 * @see docs/architecture/adrs/053-fulfillment-authority-vocabulary-leaf.md
 */
import type { RoutingShipTo } from './routing-ship-to.types';

/** One order line's participation in a routing question. */
export interface RoutingInputLine {
  readonly orderLineId: string;
  readonly productVariantId: string;
  readonly quantity: number;
}

/**
 * Everything a router is told about an order.
 *
 * There is no `Order` here and there must not be one: ADR-062 Decision 2 bounds
 * this shape by construction, and a domain entity handed to a plugin re-opens
 * every field it will ever grow.
 *
 * `requestedDeliveryMethod` is an OPAQUE key, matching the grain
 * `FulfillmentWork.deliveryMethod` holds — ADR-054 keeps order-layer sourcing
 * separate from the shipping layer's dispatch resolution, which stays
 * authoritative for label mechanics, so no delivery vocabulary is restated here.
 */
export interface RoutingInput {
  readonly orderId: string;
  readonly lines: readonly RoutingInputLine[];
  readonly shipTo: RoutingShipTo;
  readonly requestedDeliveryMethod: string | null;
}

export const ROUTING_INPUT_ALLOWED_KEYS = [
  'orderId',
  'lines',
  'shipTo',
  'requestedDeliveryMethod',
] as const;

export const ROUTING_INPUT_LINE_ALLOWED_KEYS = [
  'orderLineId',
  'productVariantId',
  'quantity',
] as const;

/**
 * Buyer-identifying fields that must never appear on `RoutingInput` or its
 * lines. Held beside the ship-to list so the guard covers the whole input, which
 * is what #2393's acceptance criterion names — a `RoutingInput.buyerEmail` would
 * sit outside `shipTo` entirely.
 */
export const ROUTING_INPUT_FORBIDDEN_KEYS = [
  'name',
  'buyerName',
  'email',
  'buyerEmail',
  'customerEmail',
  'phone',
  'buyerPhone',
  'address',
  'billingAddress',
  'shippingAddress',
  'taxId',
  'buyerTaxId',
  'order',
] as const;

/**
 * A router's committing options.
 *
 * Kept OFF `RoutingInput`, which both methods share: a committing key reachable
 * from `evaluate()` would contradict the non-committing contract. Design §5.3
 * requires the key be derived from the routing-decision row persisted before the
 * call; #2395 owns that row and populates this.
 */
export interface RouteOptions {
  readonly idempotencyKey: string;
}

/** Which rule produced a step, in the rule's own vocabulary. */
export interface RoutingRuleRef {
  /** The vendor's identifier. Opaque — never parsed or validated here. */
  readonly ruleId: string;
  /** The vendor's own name for the rule, rendered as-is. */
  readonly name: string;
  /** Operator-facing label for `name`. */
  readonly displayLabel: string;
}

/**
 * One step of "why did this order go here".
 *
 * The answer commercial DOMSes rarely show (DESIGN §5.3(b)), and the routing
 * counterpart of the sales-document engine's reported `unresolved` reason.
 * `eliminated` names what a filter removed; `score` is a sort's output, `null`
 * for a filter step.
 */
export interface RoutingExplanationStep {
  readonly rule: RoutingRuleRef;
  readonly eliminated: readonly string[];
  readonly score: number | null;
  readonly detail: string | null;
}

/**
 * Where a quantity of a line is to be sourced from.
 *
 * `locationId` and `connectionId` are NULLABLE, and deliberately so: they mirror
 * `FulfillmentWork.locationId` / `assignedConnectionId`, whose own docblocks read
 * `null` as **not yet assigned** rather than "no location applies" — a router
 * mints work before it has necessarily resolved a location, and an
 * observation-only work object on an `omp_fulfilled` topology may never acquire
 * one. #2395 creates work FROM this shape, so a non-nullable field here would
 * force it to fabricate a sentinel or widen a published port one slice later,
 * which is breaking for any implementer. `inventory_locations.ownerConnectionId`
 * is likewise nullable (`ON DELETE SET NULL`), so an operator-owned warehouse has
 * no legal connection to name.
 */
export interface RoutingAssignment {
  readonly orderLineId: string;
  readonly locationId: string | null;
  readonly connectionId: string | null;
  readonly deliveryMethod: string | null;
  readonly quantity: number;
}

export const RoutingUnfulfillableResolutionValues = ['refund', 'return'] as const;

/**
 * How an unfulfillable line resolves.
 *
 * Closed at two members on purpose (DESIGN §5.3(a)): a partial-cancel state
 * would be an invention no source can express, and OpenLinker cannot split a
 * commercial order (ADR-054).
 */
export type RoutingUnfulfillableResolution = (typeof RoutingUnfulfillableResolutionValues)[number];

/**
 * A line the router could not source.
 *
 * `reason` is opaque for the same reason rule names are — the router knows why,
 * core does not. Note the operator-facing counterpart already exists elsewhere:
 * `fulfillment-authority` ships `'routing'` as an attention producer whose
 * default reason is `'line-unfulfillable'`. That union is a PERSISTED operator
 * state; this field is a port-level statement about one line. They are
 * deliberately not the same type, and importing it would spend this leaf's
 * second allow-set entry for nothing.
 */
export interface RoutingUnfulfillableLine {
  readonly orderLineId: string;
  readonly quantity: number;
  readonly resolution: RoutingUnfulfillableResolution;
  readonly reason: string;
}

/**
 * A hold the router placed rather than assigning.
 *
 * `reason` is an OPAQUE string here, not `HoldReason` from
 * `@openlinker/core/order-lifecycle`, and that is a decision rather than an
 * oversight. Design adjudication #4 keeps one hold vocabulary across both
 * grains, but importing it would spend this leaf's SECOND `ZERO_SIBLING_EDGE_LEAVES`
 * entry for a field with no writer — holds become first-class rows in #2392, and
 * the vocabulary choice is genuinely theirs.
 *
 * Note the asymmetry with `RoutingUnfulfillableLine.resolution`, which IS a
 * closed union: the design closes that one explicitly, whereas a hold reason is
 * a cross-grain vocabulary another context owns.
 *
 * Narrowing this to `HoldReason` later is a BREAKING change for any implementer,
 * so #2392 should treat it as a decision and not a tidy-up.
 */
export interface RoutingHold {
  readonly orderLineId: string;
  readonly quantity: number;
  readonly reason: string;
}

/** A router that decided. */
export interface ResolvedRoutingPlan {
  readonly status: 'resolved';
  readonly decisionId: string;
  readonly assignments: readonly RoutingAssignment[];
  readonly unfulfillable: readonly RoutingUnfulfillableLine[];
  readonly holds: readonly RoutingHold[];
  readonly explanation: readonly RoutingExplanationStep[];
}

/**
 * A router that has accepted the question and will answer later.
 *
 * REVIEW G5's third arm, for a genuinely asynchronous DOMS (R1). Wave 3a
 * DECLARES it and rejects it with a named error — see
 * `assertRoutingPlanResolved`; consuming it is `W4-3`.
 */
export interface PendingRoutingPlan {
  readonly status: 'pending';
  readonly decisionId: string;
}

export type RoutingPlan = ResolvedRoutingPlan | PendingRoutingPlan;

/**
 * The non-committing answer.
 *
 * Carries no `decisionId` and no `holds`, so nothing a caller can persist a
 * decision from comes back off this path. `candidates` are ranked possibilities,
 * not assignments — the router has chosen nothing.
 */
export interface RoutingEvaluation {
  readonly candidates: readonly RoutingAssignment[];
  readonly unfulfillable: readonly RoutingUnfulfillableLine[];
  readonly explanation: readonly RoutingExplanationStep[];
}

/**
 * Whether a plan accounts for every unit it was asked about.
 *
 * Per `orderLineId`, assigned + unfulfillable + held must equal the input line's
 * quantity, and the plan may name no line the input did not. A plan that
 * silently drops a line is unfulfilled stock with every surface reporting
 * success — the failure mode nothing downstream can detect on its own.
 *
 * Pure, and here rather than in #2395 for the reason `checkFulfillmentWorkLineCapacity`
 * is: the rule exists once, before the code that depends on it. `check*` rather
 * than `is*` because it narrows nothing (`checkRequiredToSell` precedent).
 */
export function checkRoutingPlanConservesQuantities(
  input: RoutingInput,
  plan: ResolvedRoutingPlan,
): boolean {
  const expected = new Map<string, number>();
  for (const line of input.lines) {
    expected.set(line.orderLineId, (expected.get(line.orderLineId) ?? 0) + line.quantity);
  }

  const accounted = new Map<string, number>();
  const add = (orderLineId: string, quantity: number): void => {
    accounted.set(orderLineId, (accounted.get(orderLineId) ?? 0) + quantity);
  };
  plan.assignments.forEach((a) => add(a.orderLineId, a.quantity));
  plan.unfulfillable.forEach((u) => add(u.orderLineId, u.quantity));
  plan.holds.forEach((h) => add(h.orderLineId, h.quantity));

  for (const orderLineId of accounted.keys()) {
    if (!expected.has(orderLineId)) {
      return false;
    }
  }

  for (const [orderLineId, quantity] of expected) {
    if ((accounted.get(orderLineId) ?? 0) !== quantity) {
      return false;
    }
  }

  return true;
}
