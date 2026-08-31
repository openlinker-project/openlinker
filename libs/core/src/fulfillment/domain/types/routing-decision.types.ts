/**
 * Routing Decision vocabulary (#2394, `W3a-5`, ADR-054 R1, DESIGN §5.3)
 *
 * The state a routing INTENT row moves through, and the pure derivation of the
 * idempotency key `route()` is called with.
 *
 * ## Why an intent row exists at all
 *
 * REVIEW C2: **persisted evidence must land before the boundary it protects.**
 * A lock alone cannot supply that ordering — it is lost on process death, on a
 * TTL expiry or on a Redis blip, and the peer that acquires it next has no way
 * to learn a `route()` call is already in flight. The shipped #2047 invoicing
 * guard is the shape being copied.
 *
 * ## The key is DERIVED, never stored
 *
 * `deriveRouteIdempotencyKey` is a function of the decision row's own id, which
 * is immutable. So a **retry** of a crashed route re-derives a byte-identical
 * key, while a **re-route** (DESIGN §5.4's `short_picked` + `releaseShortfall`)
 * is a new row with a new id and therefore a new key — correct, because a
 * genuinely new decision must not dedup against the previous one.
 *
 * This is the #2039 `reconcileId` lesson: a retrying or resuming job is a
 * DIFFERENT job, so the key must never come from the job id.
 *
 * It is not persisted, and the reason is structural rather than tidy: a stored
 * column can be written with a value that is not the derivation, whereas
 * deriving makes "the key is a function of the row" true by construction.
 * If a router ever echoes a key back, or an operator needs to correlate against
 * a vendor's own log, persist it THEN — an additive nullable column.
 *
 * @module libs/core/src/fulfillment/domain/types
 * @see docs/plans/analysis/DESIGN-oms-authority-model.md §5.3
 * @see docs/architecture/adrs/054-fulfillment-work-unit-of-assignment.md
 */

export const RoutingDecisionStateValues = ['live', 'committed', 'abandoned'] as const;

/**
 * Where a routing decision stands.
 *
 * `live` is the only state the partial-unique index constrains — see the ORM
 * entity for why the predicate is exactly that wide. `committed` and
 * `abandoned` are both terminal and both leave the index, which is what lets a
 * legitimate re-route claim the order again.
 */
export type RoutingDecisionState = (typeof RoutingDecisionStateValues)[number];

export const isRoutingDecisionState = (value: unknown): value is RoutingDecisionState =>
  typeof value === 'string' && (RoutingDecisionStateValues as readonly string[]).includes(value);

/**
 * Values declared here correspond to code that ALREADY SHIPS, and nothing else.
 *
 * - `plan-pending` — #2393's `PendingRoutingPlanNotSupportedError`: the router
 *   accepted the question and will answer later, which Wave 3a refuses.
 * - `plan-not-conserving` — #2393's `checkRoutingPlanConservesQuantities`: the
 *   plan does not account for every unit it was asked about.
 *
 * Candidates describing #2395's own internals (a throwing `route()`, a lost
 * lock) are deliberately NOT declared here — they would be guesses about code
 * that does not exist. The column is `varchar(64)`, so #2395 adds its own
 * members with no migration.
 *
 * `readRoutingDecisionAbandonReason` coerces an unrecognised value to `null`
 * (the #2100 rule) so a value written by a newer build reads as absent on an
 * older one rather than crashing it.
 */
export const RoutingDecisionAbandonReasonValues = ['plan-pending', 'plan-not-conserving'] as const;

export type RoutingDecisionAbandonReason = (typeof RoutingDecisionAbandonReasonValues)[number];

export const isRoutingDecisionAbandonReason = (
  value: unknown,
): value is RoutingDecisionAbandonReason =>
  typeof value === 'string' &&
  (RoutingDecisionAbandonReasonValues as readonly string[]).includes(value);

/** Coerce a persisted reason, reading anything unrecognised as absent. */
export const readRoutingDecisionAbandonReason = (
  value: unknown,
): RoutingDecisionAbandonReason | null => (isRoutingDecisionAbandonReason(value) ? value : null);

/**
 * The key handed to `FulfillmentRouterPort.route(input, options)`.
 *
 * Pure, and beside the type it is about — the `*.types.ts` pure-rule exception
 * (`engineering-standards.md`), the shape `applyPricingRule` and
 * `resolveOfferLifecycle` already take.
 */
export const deriveRouteIdempotencyKey = (decisionId: string): string => `route:${decisionId}`;
