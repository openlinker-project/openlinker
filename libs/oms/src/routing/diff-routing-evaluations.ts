/**
 * Diff two routing evaluations of the same order (#2954)
 *
 * Powers the dry run's "compare" state: the operator sees the saved ruleset and
 * their unsaved draft side by side, and this names the order lines whose
 * placement differs between the two. Pure: no I/O, no clock, no argument
 * mutation.
 *
 * A line is "changed" when the multiset of its assignments (location + quantity)
 * or its unfulfillable quantity differs. The order the router happened to list
 * assignments in is not a difference - two routings that put the same units in
 * the same places are the same routing.
 *
 * @module libs/oms/src/routing
 */
import type { RoutingEvaluation } from '@openlinker/core/fulfillment';

export interface RoutingLineChange {
  readonly orderLineId: string;
  /** `locationId:quantity` pairs, sorted, for the saved ruleset. `none` marks an unplaced line. */
  readonly saved: readonly string[];
  readonly draft: readonly string[];
}

function placement(evaluation: RoutingEvaluation, orderLineId: string): readonly string[] {
  const assigned = evaluation.candidates
    .filter((candidate) => candidate.orderLineId === orderLineId)
    .map((candidate) => `${candidate.locationId ?? 'unassigned'}:${candidate.quantity}`);
  const unfulfillable = evaluation.unfulfillable
    .filter((line) => line.orderLineId === orderLineId)
    .map((line) => `unfulfillable:${line.quantity}`);
  return [...assigned, ...unfulfillable].sort();
}

export function diffRoutingEvaluations(
  saved: RoutingEvaluation,
  draft: RoutingEvaluation
): readonly RoutingLineChange[] {
  const lineIds = new Set<string>([
    ...saved.candidates.map((c) => c.orderLineId),
    ...saved.unfulfillable.map((l) => l.orderLineId),
    ...draft.candidates.map((c) => c.orderLineId),
    ...draft.unfulfillable.map((l) => l.orderLineId),
  ]);

  const changes: RoutingLineChange[] = [];
  for (const orderLineId of [...lineIds].sort()) {
    const before = placement(saved, orderLineId);
    const after = placement(draft, orderLineId);
    if (before.length !== after.length || before.some((value, index) => value !== after[index])) {
      changes.push({ orderLineId, saved: before, draft: after });
    }
  }
  return changes;
}
