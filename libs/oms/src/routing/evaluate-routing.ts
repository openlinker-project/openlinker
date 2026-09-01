/**
 * The OL router's one pure pipeline
 *
 * `evaluate()` and `route()` both call this and nothing else, which is what
 * makes their explanations provably identical for the same input rather than
 * merely similar. No I/O, no clock, no mutation of its arguments.
 *
 * @module libs/oms/src/routing
 */
import type {
  RoutingAssignment,
  RoutingExplanationStep,
  RoutingInput,
  RoutingUnfulfillableLine,
} from '@openlinker/core/fulfillment';

import type { RoutingCandidate, RoutingFacts } from './routing-facts.types';
import { stockKey } from './routing-facts.types';
import type { RoutingRule, RoutingSortRule } from './routing-rule.types';
import { mostRestrictiveAfterAction, type RoutingAfterAction } from './routing-vocabulary.types';

export interface RoutingPipelineResult {
  readonly assignments: readonly RoutingAssignment[];
  readonly unfulfillable: readonly RoutingUnfulfillableLine[];
  readonly explanation: readonly RoutingExplanationStep[];
}

const UNRANKED = Number.MAX_SAFE_INTEGER;

function availableAt(facts: RoutingFacts, locationId: string, variantId: string): number {
  return facts.stock.get(stockKey(locationId, variantId)) ?? 0;
}

function linesCoverable(input: RoutingInput, facts: RoutingFacts, candidate: RoutingCandidate): number {
  return input.lines.filter((line) => availableAt(facts, candidate.locationId, line.productVariantId) >= line.quantity)
    .length;
}

/** Shared postcode prefix length — the `nearest` proximity proxy's only real term. */
function sharedPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) {
    i += 1;
  }
  return i;
}

function sameCountry(candidate: RoutingCandidate, shipToCountry: string): boolean {
  return candidate.countryIso2 !== null && candidate.countryIso2.toUpperCase() === shipToCountry.toUpperCase();
}

/**
 * Apply one filter, returning the survivors and the step that explains it.
 *
 * A filter never eliminates a candidate it cannot make a positive statement
 * about: an unknown country or an absent holder is "not shown to fail", not
 * "shown to fail", and the difference is stated in `detail` so an operator can
 * see why a candidate survived a filter they expected to remove it.
 */
function applyFilter(
  rule: RoutingRule,
  candidates: readonly RoutingCandidate[],
  input: RoutingInput,
  facts: RoutingFacts
): { readonly survivors: readonly RoutingCandidate[]; readonly step: RoutingExplanationStep } {
  let survivors = candidates;
  let detail: string | null = null;

  if (rule.name === 'in-stock') {
    survivors = candidates.filter((candidate) =>
      input.lines.some((line) => availableAt(facts, candidate.locationId, line.productVariantId) > 0)
    );
    detail = 'kept locations holding stock for at least one line';
  } else if (rule.name === 'country-served') {
    const unknown = candidates.filter((candidate) => candidate.countryIso2 === null).length;
    survivors = candidates.filter(
      (candidate) => candidate.countryIso2 === null || sameCountry(candidate, input.shipTo.countryIso2)
    );
    detail =
      `a location serves the country it sits in (its own countryIso2 — not a serve-list)` +
      (unknown > 0 ? `; ${unknown} location(s) with no country recorded were not eliminated` : '');
  } else if (rule.name === 'not-blocked-by-reject') {
    const unheld = candidates.filter((candidate) => candidate.connectionId === null).length;
    survivors = candidates.filter(
      (candidate) => candidate.connectionId === null || !facts.blockedConnectionIds.has(candidate.connectionId)
    );
    detail =
      `excluded holders that rejected this order with a blocking reason` +
      (unheld > 0 ? `; ${unheld} location(s) with no holding connection were never eligible for exclusion` : '');
  }

  const survivorIds = new Set(survivors.map((candidate) => candidate.locationId));

  return {
    survivors,
    step: {
      rule: { ruleId: rule.id, name: rule.name, displayLabel: rule.name },
      eliminated: candidates.filter((c) => !survivorIds.has(c.locationId)).map((c) => c.locationId),
      score: null,
      detail,
    },
  };
}

/** The score a sort assigns a candidate. Lower ranks earlier. */
function scoreFor(
  rule: RoutingSortRule,
  candidate: RoutingCandidate,
  input: RoutingInput,
  facts: RoutingFacts
): number {
  if (rule.name === 'priority') {
    const index = rule.priorityLocationIds.indexOf(candidate.locationId);
    return index === -1 ? UNRANKED : index;
  }

  if (rule.name === 'most-complete') {
    return -linesCoverable(input, facts, candidate);
  }

  if (rule.name === 'least-splits') {
    // Delegates to the same predicate `no-split` gates on, rather than counting
    // satisfiable lines: a location that "covers every line" line-by-line but
    // cannot cover their summed demand would otherwise be ranked first for
    // producing a single fulfilment it cannot actually produce.
    return coversWholeOrder(input, facts, candidate) ? 0 : 1;
  }

  // `nearest` — a proximity PROXY, never a geodesic distance: RoutingShipTo
  // carries no coordinates on either arm and OpenLinker cannot geocode a
  // postcode. Exact postcode match, then shared prefix, then same country.
  const shipToPostcode = input.shipTo.mode === 'plain' ? input.shipTo.postalCode : null;
  if (shipToPostcode !== null && candidate.postcode !== null) {
    if (shipToPostcode === candidate.postcode) {
      return 0;
    }
    return 100 - sharedPrefix(shipToPostcode, candidate.postcode);
  }
  return sameCountry(candidate, input.shipTo.countryIso2) ? 500 : UNRANKED;
}

function describeSort(rule: RoutingSortRule, input: RoutingInput): string | null {
  if (rule.name !== 'nearest') {
    return rule.name === 'priority' && rule.priorityLocationIds.length === 0
      ? 'no priority order authored, so this rule ranked nothing'
      : null;
  }

  // The degradation must be VISIBLE, not merely true: a ranking that quietly
  // stops ranking cannot be falsified from the outside.
  return input.shipTo.mode === 'hashed'
    ? 'ship-to is hashed (OL_STORE_PII=false), so there is no postcode: ranked by country only'
    : 'proximity proxy (exact postcode, then shared prefix, then country) — not a geodesic distance';
}

/**
 * Rank the survivors. Sorts are applied as a composite comparator in the order
 * the operator authored them, so the FIRST sort is the primary key. Ties break
 * on `locationId` so a plan never depends on the order rows arrived in.
 */
function rankCandidates(
  sorts: readonly RoutingSortRule[],
  candidates: readonly RoutingCandidate[],
  input: RoutingInput,
  facts: RoutingFacts
): readonly RoutingCandidate[] {
  return [...candidates].sort((a, b) => {
    for (const rule of sorts) {
      const delta = scoreFor(rule, a, input, facts) - scoreFor(rule, b, input, facts);
      if (delta !== 0) {
        return delta;
      }
    }
    return a.locationId.localeCompare(b.locationId);
  });
}


/**
 * Which after-action governs this ruleset, and which rule authored it.
 *
 * The most restrictive rung wins (see `mostRestrictiveAfterAction`), and the
 * rule cited is the FIRST rule in evaluation order that declares it — so the
 * explanation names a real, stable `ruleId` an operator can go and edit rather
 * than an anonymous derived verdict.
 */
function resolveSplitPolicy(rules: readonly RoutingRule[]): {
  readonly allowance: RoutingAfterAction;
  readonly governingRule: RoutingRule | null;
} {
  const allowance = mostRestrictiveAfterAction(rules.map((rule) => rule.afterAction));
  return {
    allowance,
    governingRule: rules.find((rule) => rule.afterAction === allowance) ?? null,
  };
}

/**
 * Total demand per variant across the whole order.
 *
 * Two lines CAN name the same variant, and the difference matters: compared
 * line-by-line, a location holding 6 units "covers" two 5-unit lines, because
 * each comparison sees the full 6. `no-split` would then commit 10 units to a
 * location holding 6 — an over-commitment that conserves the ORDER's quantities
 * and so passes `checkRoutingPlanConservesQuantities`, which is exactly the
 * blind spot that made the paged-stock double-count worth fixing too. Demand is
 * therefore summed per variant before it is compared with anything.
 */
function demandByVariant(input: RoutingInput): ReadonlyMap<string, number> {
  const demand = new Map<string, number>();
  for (const line of input.lines) {
    demand.set(line.productVariantId, (demand.get(line.productVariantId) ?? 0) + line.quantity);
  }
  return demand;
}

/** Can this candidate source every line of the order on its own? */
function coversWholeOrder(input: RoutingInput, facts: RoutingFacts, candidate: RoutingCandidate): boolean {
  for (const [variantId, quantity] of demandByVariant(input)) {
    if (availableAt(facts, candidate.locationId, variantId) < quantity) {
      return false;
    }
  }
  return true;
}

/**
 * Assign each line across the ranked candidates, honouring the split ladder.
 *
 * The three rungs are genuinely three different assignments, which is why they
 * are branched on rather than reduced to one boolean:
 *
 * - `no-split` — ONE location carries the whole order or none of it. Note this
 *   is strictly stronger than forbidding a *quantity* split: a plan placing
 *   line A at one location and line B at another splits the order across two
 *   fulfilments, two picks and two parcels, which is exactly what an operator
 *   authoring `no-split` is asking not to happen. Reading it as the weaker
 *   quantity rule would honour the word and break the promise.
 * - `line-split` — each line wholly from one location; different lines may
 *   differ.
 * - `quantity-split` — a line's quantity may be spread across locations.
 *
 * A line that cannot be sourced under the governing rung reports the shortfall
 * as `unfulfillable`, naming the rung when the rung is the cause. That is the
 * TRUE answer, and Wave 3a's committer refuses a plan carrying one
 * (`plan-carries-unfulfillable`, #2730) — a clean, named, persisted
 * terminalisation. The alternative, assigning the shortfall to a `null`
 * location, would conserve quantities and be wrong: it commits a work row for
 * stock that does not exist, which is the very failure
 * `checkRoutingPlanConservesQuantities` exists to catch, one level up.
 */
function assignLines(
  ranked: readonly RoutingCandidate[],
  input: RoutingInput,
  facts: RoutingFacts,
  allowance: RoutingAfterAction
): { readonly assignments: RoutingAssignment[]; readonly unfulfillable: RoutingUnfulfillableLine[] } {
  const assignments: RoutingAssignment[] = [];
  const unfulfillable: RoutingUnfulfillableLine[] = [];

  const noCandidates = ranked.length === 0;
  const eliminatedReason = 'every candidate location was eliminated by the configured filters';

  if (allowance === 'no-split') {
    const sole = ranked.find((candidate) => coversWholeOrder(input, facts, candidate));

    if (sole === undefined) {
      for (const line of input.lines) {
        unfulfillable.push({
          orderLineId: line.orderLineId,
          quantity: line.quantity,
          resolution: 'refund',
          reason: noCandidates
            ? eliminatedReason
            : 'no single surviving location holds every line of this order, and the ruleset forbids splitting it',
        });
      }
      return { assignments, unfulfillable };
    }

    for (const line of input.lines) {
      assignments.push({
        orderLineId: line.orderLineId,
        locationId: sole.locationId,
        connectionId: sole.connectionId,
        deliveryMethod: input.requestedDeliveryMethod,
        quantity: line.quantity,
      });
    }
    return { assignments, unfulfillable };
  }

  const allowQuantitySplit = allowance === 'quantity-split';

  const remaining = new Map<string, number>();
  for (const candidate of ranked) {
    for (const line of input.lines) {
      const key = stockKey(candidate.locationId, line.productVariantId);
      remaining.set(key, availableAt(facts, candidate.locationId, line.productVariantId));
    }
  }

  for (const line of input.lines) {
    let outstanding = line.quantity;

    for (const candidate of ranked) {
      if (outstanding === 0) {
        break;
      }
      const key = stockKey(candidate.locationId, line.productVariantId);
      const available = remaining.get(key) ?? 0;
      if (available === 0) {
        continue;
      }
      // `line-split` means one location must carry the whole LINE or none of it.
      if (!allowQuantitySplit && available < outstanding) {
        continue;
      }

      const take = Math.min(available, outstanding);
      assignments.push({
        orderLineId: line.orderLineId,
        locationId: candidate.locationId,
        connectionId: candidate.connectionId,
        deliveryMethod: input.requestedDeliveryMethod,
        quantity: take,
      });
      remaining.set(key, available - take);
      outstanding -= take;
    }

    if (outstanding > 0) {
      unfulfillable.push({
        orderLineId: line.orderLineId,
        quantity: outstanding,
        resolution: 'refund',
        reason: noCandidates
          ? eliminatedReason
          : allowQuantitySplit
            ? 'no surviving location holds enough stock for this line'
            : 'no single surviving location holds this whole line, and the ruleset forbids splitting a line across locations',
      });
    }
  }

  return { assignments, unfulfillable };
}

/**
 * The explanation step for the governing split rung.
 *
 * Emitted only when a rule actually restricts (`no-split` / `line-split`),
 * because that is when the rung changes the outcome and has something to
 * report. `quantity-split` is what an unconfigured install already does, so a
 * step for it would be a line of explanation for a decision nobody made — and
 * it would break the "absent config is inert" acceptance criterion, which the
 * no-rules case asserts by demanding an EMPTY explanation.
 *
 * Under `no-split` the eliminations are real and are listed: a candidate that
 * survived every filter but cannot carry the whole order was ruled out HERE,
 * and an operator reading the plan has to be able to see that rather than
 * infer it from an absence.
 */
function describeSplitPolicy(
  allowance: RoutingAfterAction,
  governingRule: RoutingRule | null,
  ranked: readonly RoutingCandidate[],
  input: RoutingInput,
  facts: RoutingFacts
): RoutingExplanationStep | null {
  if (governingRule === null || allowance === 'quantity-split') {
    return null;
  }

  const eliminated =
    allowance === 'no-split'
      ? ranked.filter((candidate) => !coversWholeOrder(input, facts, candidate)).map((c) => c.locationId)
      : [];

  return {
    rule: { ruleId: governingRule.id, name: governingRule.name, displayLabel: governingRule.name },
    eliminated,
    score: null,
    detail:
      allowance === 'no-split'
        ? 'no-split: one location must source the whole order — locations that cannot were ruled out here'
        : 'line-split: each line must be sourced wholly from one location, but lines may differ',
  };
}

/**
 * Run the whole pipeline. Pure.
 */
export function evaluateRouting(
  input: RoutingInput,
  rules: readonly RoutingRule[],
  facts: RoutingFacts
): RoutingPipelineResult {
  const explanation: RoutingExplanationStep[] = [];
  let survivors: readonly RoutingCandidate[] = facts.candidates;

  for (const rule of rules) {
    if (rule.kind !== 'filter') {
      continue;
    }
    const { survivors: kept, step } = applyFilter(rule, survivors, input, facts);
    survivors = kept;
    explanation.push(step);
  }

  const sorts = rules.filter((rule): rule is RoutingSortRule => rule.kind === 'sort');
  const ranked = rankCandidates(sorts, survivors, input, facts);

  for (const rule of sorts) {
    explanation.push({
      rule: { ruleId: rule.id, name: rule.name, displayLabel: rule.name },
      eliminated: [],
      score: ranked.length > 0 ? scoreFor(rule, ranked[0], input, facts) : null,
      detail: describeSort(rule, input),
    });
  }

  const { allowance, governingRule } = resolveSplitPolicy(rules);
  const splitStep = describeSplitPolicy(allowance, governingRule, ranked, input, facts);
  if (splitStep !== null) {
    explanation.push(splitStep);
  }

  const { assignments, unfulfillable } = assignLines(ranked, input, facts, allowance);

  return { assignments, unfulfillable, explanation };
}
