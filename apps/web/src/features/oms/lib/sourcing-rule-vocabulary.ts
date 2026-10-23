/**
 * Sourcing-rule vocabulary mirror (#3057)
 *
 * A hand-maintained copy of the closed vocabularies in
 * `libs/oms/src/routing/routing-vocabulary.types.ts`. The browser bundle does
 * not depend on `@openlinker/*` (#591), so there is no import to make here —
 * `scripts/check-sourcing-rule-vocabulary-mirror.mjs` (run by
 * `pnpm check:invariants`) is what keeps the two identical.
 *
 * ## This is an OFFER list, never a PARSE list
 *
 * `sourcing-rules.types.ts` deliberately types `kind` / `name` / `afterAction`
 * as `string` on the wire, because the API reports a rule this build cannot
 * evaluate with `recognised: false` rather than hiding it, and a `z.enum` at the
 * boundary would hide it again by failing the parse. These arrays are the
 * complementary half: what an operator may CHOOSE, and which values carry a
 * sentence. Nothing here may be used to reject an arriving value.
 *
 * ## The permissiveness ranking is the load-bearing part
 *
 * `mostRestrictiveAfterAction` is the frontend twin of core's function of the
 * same name, and the ranking — not the array order — is what makes it correct.
 * Core's own `RoutingAfterActionValues` is declared in a different order again,
 * which is exactly why the mirror script compares the RANKING by value and the
 * arrays by membership: an array reorder is harmless, a ranking swap would have
 * the table name the wrong rule as the one restricting splits.
 *
 * @module apps/web/src/features/oms/lib
 */

/** Filters rule locations OUT. Mirrors `RoutingFilterNameValues`. */
export const SOURCING_FILTER_NAME_VALUES = [
  'in-stock',
  'country-served',
  'not-blocked-by-reject',
] as const;
export type SourcingFilterName = (typeof SOURCING_FILTER_NAME_VALUES)[number];

/** Sorts RANK whatever the filters left. Mirrors `RoutingSortNameValues`. */
export const SOURCING_SORT_NAME_VALUES = [
  'priority',
  'nearest',
  'most-complete',
  'least-splits',
] as const;
export type SourcingSortName = (typeof SOURCING_SORT_NAME_VALUES)[number];

/** Mirrors `RoutingRuleKindValues`. */
export const SOURCING_RULE_KIND_VALUES = ['filter', 'sort'] as const;
export type SourcingRuleKind = (typeof SOURCING_RULE_KIND_VALUES)[number];

/** Mirrors `RoutingAfterActionValues` — declaration order, not restrictiveness. */
export const SOURCING_AFTER_ACTION_VALUES = ['line-split', 'quantity-split', 'no-split'] as const;
export type SourcingAfterAction = (typeof SOURCING_AFTER_ACTION_VALUES)[number];

/**
 * Lower is MORE restrictive. Mirrors core's `AFTER_ACTION_PERMISSIVENESS`.
 *
 * Each rung is strictly contained in the next, which is what makes "take the
 * most restrictive" the only safe reduction: a rule saying "do not split this
 * order" has been honoured only if nothing else in the ruleset then splits it.
 */
export const AFTER_ACTION_PERMISSIVENESS: Readonly<Record<SourcingAfterAction, number>> = {
  'no-split': 0,
  'line-split': 1,
  'quantity-split': 2,
};

export function isSourcingRuleKind(value: string): value is SourcingRuleKind {
  return (SOURCING_RULE_KIND_VALUES as readonly string[]).includes(value);
}

export function isSourcingAfterAction(value: string): value is SourcingAfterAction {
  return (SOURCING_AFTER_ACTION_VALUES as readonly string[]).includes(value);
}

/**
 * The after-action that governs a set.
 *
 * Frontend twin of core's `mostRestrictiveAfterAction`. An empty input answers
 * `quantity-split`: with no rule declaring anything there is no restriction to
 * honour, which is what keeps an unconfigured install reading as "nothing is
 * restricted" rather than as "splitting is forbidden".
 *
 * A value this build does not recognise is IGNORED rather than treated as most
 * restrictive: guessing would state a limit the operator never authored.
 */
export function mostRestrictiveAfterAction(actions: readonly string[]): SourcingAfterAction {
  let winner: SourcingAfterAction = 'quantity-split';
  for (const action of actions) {
    if (!isSourcingAfterAction(action)) continue;
    if (AFTER_ACTION_PERMISSIVENESS[action] < AFTER_ACTION_PERMISSIVENESS[winner]) {
      winner = action;
    }
  }
  return winner;
}
