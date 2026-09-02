/**
 * OL Router — the closed named filter and sort vocabulary
 *
 * The names an operator may sequence into a routing ruleset, and the split
 * behaviour a rule may declare. Closed on purpose (DESIGN §5.3(c), REVIEW H7):
 * a routing rule has to stay reviewable, and an open predicate language is what
 * stops it being. ANALYSIS-1032 cut Wave 3's rules engine on evidence; filters
 * plus sorts is the smaller true shape.
 *
 * These names are plugin-owned. Core carries only `RoutingRuleRef`, whose rule
 * names are opaque strings with display labels, so a third-party router's own
 * vocabulary renders in the same explanation an operator reads.
 *
 * ## A member is declared only when a fact source can make it select
 *
 * `method-capable` is deliberately ABSENT. No per-location delivery-method
 * model exists anywhere in the tree, so the filter could never eliminate a
 * candidate — an operator authoring it would believe they had constrained
 * routing by delivery method and would be silently wrong. A prohibition is
 * honest with no subject; a declaration is not. Owned by #2736.
 *
 * ## Why a runtime function lives in a `*.types.ts`
 *
 * `mostRestrictiveAfterAction` invokes the pure-rule exception in
 * `docs/engineering-standards.md` § "The pure-rule exception to 'types only'
 * (#2231)", and satisfies all three conditions. It is **pure** (a function of
 * its argument alone — no I/O, no dependency, no mutation); it **is** the rule
 * for the type it sits with (reducing a set of `RoutingAfterAction` values to
 * the one that governs is what the ladder MEANS, not a use case that happens to
 * take the type); and **both halves change together** — adding a rung means
 * editing the permissiveness table in the same commit, which is precisely the
 * property that keeps a fourth rung from silently ranking equal to an existing
 * one. Same precedent as `resolveOfferLifecycle` beside
 * `offer-lifecycle.types.ts`.
 *
 * @module libs/oms/src/routing
 * @see docs/plans/analysis/DESIGN-oms-authority-model.md §5.3
 */

/**
 * Filters eliminate candidate locations. Each name below has a verified fact
 * source in the merged tree:
 *
 * - `in-stock` — the location holds stock for the line's variant
 *   (`IInventoryQueryService.listInventoryItems` filtered by `locationId`).
 * - `country-served` — **the location serves the country it sits in.** This is
 *   the precise claim, and it is narrower than the name suggests:
 *   `InventoryLocation.countryIso2` records where the location *is*, not a list
 *   of countries it ships to, and no serve-list column exists. Any config or
 *   operator-facing copy for this filter must state the weaker meaning rather
 *   than implying the stronger one.
 * - `not-blocked-by-reject` — a fulfiller that rejected this order with a
 *   blocking reason is excluded from re-sourcing (ADR-054).
 */
export const RoutingFilterNameValues = ['in-stock', 'country-served', 'not-blocked-by-reject'] as const;

export type RoutingFilterName = (typeof RoutingFilterNameValues)[number];

/**
 * Sorts rank the surviving candidates.
 *
 * - `priority` — an operator-authored ordered list of location ids, carried on
 *   the rule's own config. Unlisted locations rank last, in stable order.
 * - `nearest` — a documented **proximity proxy**, not a geodesic distance.
 *   `RoutingShipTo` carries no coordinates on either arm and OpenLinker cannot
 *   geocode a postcode, so true distance is uncomputable even though
 *   `InventoryLocation` has latitude/longitude. Ranks by exact postcode match,
 *   then shared postcode-prefix length, then same country. On the **hashed**
 *   ship-to arm there is no postcode at all and it degrades to the country term
 *   alone — a degradation the emitted explanation step must state, because a
 *   ranking that quietly stops ranking is unfalsifiable from the outside.
 * - `most-complete` — prefers the location satisfying the most order lines.
 * - `least-splits` — prefers a single location covering every line.
 */
export const RoutingSortNameValues = ['priority', 'nearest', 'most-complete', 'least-splits'] as const;

export type RoutingSortName = (typeof RoutingSortNameValues)[number];

/**
 * What a rule permits once it has run (ADR-054): whether the surviving
 * candidates may split the order's work per line, per quantity, or not at all.
 */
export const RoutingAfterActionValues = ['line-split', 'quantity-split', 'no-split'] as const;

export type RoutingAfterAction = (typeof RoutingAfterActionValues)[number];

/** Whether a rule eliminates candidates or ranks them. */
export const RoutingRuleKindValues = ['filter', 'sort'] as const;

export type RoutingRuleKind = (typeof RoutingRuleKindValues)[number];

/**
 * The three after-actions form a **ladder**, least permissive first, and the
 * ladder is the whole meaning of the field:
 *
 * - `no-split` — the WHOLE order is sourced from ONE location, or from none.
 * - `line-split` — different lines may come from different locations, but a
 *   single line must be sourced wholly from one location.
 * - `quantity-split` — a single line's quantity may be spread across locations.
 *
 * Each rung is strictly contained in the next, so a ruleset mixing them is
 * resolved by taking the MOST RESTRICTIVE rung any rule declares. That is the
 * only safe reduction: a rule saying "do not split this order" has been
 * satisfied only if nothing else in the ruleset then splits it, so a permissive
 * sibling must not be able to lift a restriction the operator authored.
 */
const AFTER_ACTION_PERMISSIVENESS: Readonly<Record<RoutingAfterAction, number>> = {
  'no-split': 0,
  'line-split': 1,
  'quantity-split': 2,
};

/**
 * Reduce the after-actions a ruleset declares to the one that governs, taking
 * the most restrictive. An empty input answers `quantity-split`: with no rule
 * declaring anything there is no restriction to honour, which is what keeps an
 * unconfigured install byte-identical to having no router at all.
 */
export function mostRestrictiveAfterAction(
  actions: readonly RoutingAfterAction[]
): RoutingAfterAction {
  let winner: RoutingAfterAction = 'quantity-split';
  for (const action of actions) {
    if (AFTER_ACTION_PERMISSIVENESS[action] < AFTER_ACTION_PERMISSIVENESS[winner]) {
      winner = action;
    }
  }
  return winner;
}
