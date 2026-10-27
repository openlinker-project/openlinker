/**
 * Destination-routing block reason (#2703 / #2704, design §5.5)
 *
 * Why a fulfilment routing decision narrowed — or emptied — the destination
 * fan-out for one order, so that `/orders` can tell **a working router making a
 * decision** apart from **a broken or empty configuration**. That distinction is
 * precisely what routing exists to make, and before this it existed only at the
 * branch inside `OrderSyncService`: both conditions rendered "No destinations".
 *
 * ## Not `syncStatus`, and not `omsAttention` / `fulfillmentBlockReason`
 *
 * #2703 opens by guessing "most likely a distinct `syncStatus` arm" and then
 * names the #2100 persisted-reason precedent as the closer match. This is the
 * #2100 shape, for three reasons a `syncStatus` arm cannot answer:
 *
 *   1. A `syncStatus` row is keyed by `destinationConnectionId`, and the whole
 *      content of the `routed-to-no-destination` case is that there is none —
 *      `syncOrder` returns `[]` with no id to key a row on.
 *   2. A new `syncStatus` arm is exactly what a consumer could route into a
 *      retry, which is the property #2397 bought and #2703's own AC 3 preserves.
 *   3. `OrderSyncStatusFilterValues` is documented as the single source of truth
 *      for the persisted payload AND `GET /orders?syncStatus=`, so widening it
 *      would widen the public query vocabulary for a value that can never appear
 *      on a real destination row.
 *
 * It is equally NOT `omsAttention` (whose `AuthorityAttentionReason` is a closed
 * union about *who decides what* — destination-mirror creation is a commercial
 * act, distinct from fulfilment assignment) and NOT `fulfillmentBlockReason`
 * (which records that the intercept HELD the order so `syncOrder` was never
 * called, whereas this records what happened INSIDE it). Those two are mutually
 * exclusive with this one by construction — see `OrderIngestionService`, which
 * clears this reason on the held branch — so nothing here can double-count
 * `Needs attention (N)`.
 *
 * ## Naming
 *
 * `DestinationRouting*` rather than `Routing*`: `RoutingOutcome` and the
 * `InboundRoutingPolicy*` family are already exported from `@openlinker/core/sync`
 * for INBOUND WEBHOOK routing (which job type a webhook routes to) — an unrelated
 * concern that would read as the same one at a call site.
 *
 * @module libs/core/src/orders/domain/types
 * @see {@link https://github.com/openlinker-project/openlinker/issues/2703}
 * @see {@link https://github.com/openlinker-project/openlinker/issues/2704}
 */

/**
 * Every reason a routing decision left the destination fan-out narrowed.
 *
 * `null` on the record means "routing narrowed nothing" — which is every order
 * on every install today, since no production caller populates
 * `OrderSyncRequest.destinationConnectionIds` yet.
 */
export const DestinationRoutingBlockReasonValues = [
  /**
   * The routing decision positively named NO destination (`destinationConnectionIds: []`).
   *
   * **A DECISION, not a fault** — a working router choosing that this order is
   * fulfilled some other way. It is rendered neutrally and is deliberately
   * absent from {@link DestinationRoutingAttentionReasonValues}: see that
   * constant for why counting it would put a red badge on a healthy install.
   */
  'routed-to-no-destination',
  /**
   * The decision named destinations and NONE is currently eligible — unknown,
   * inactive, or not `OrderProcessorManager`-capable.
   *
   * This is #2704's regression: an order whose only routed destination is
   * momentarily disabled becomes a total failure where an unfiltered fan-out
   * would still have reached its siblings. `syncOrder` throws here (so the retry
   * ladder can pick the order up once the connection is re-enabled) and persists
   * this reason FIRST, so an operator can see that a *named destination was
   * unreachable* rather than that "nothing is configured".
   */
  'routed-destinations-unavailable',
  /**
   * The decision named several destinations and only SOME resolved. The order
   * mirrors to fewer destinations than routing asked for.
   *
   * Before #2704 this was reachable and reported by a `logger.warn` alone: the
   * throw branch is entered only when NOTHING resolved, so a partially-resolved
   * decision proceeded silently under-provisioned. Nothing outside the log said
   * so, which is the same defect shape #2703 describes one condition over.
   */
  'routed-destinations-partially-unavailable',
  /**
   * Every named destination WAS the source connection itself.
   *
   * Source-echo ids are excluded before the routing filter is applied, so such
   * an id was dropped BY DESIGN and is not an unreachable connection — reporting
   * it as one would tell an operator a working connection is broken. It is a
   * distinct router misconfiguration and gets its own value rather than being
   * folded into `routed-destinations-unavailable`.
   */
  'routed-to-source-only',
] as const;

export type DestinationRoutingBlockReason = (typeof DestinationRoutingBlockReasonValues)[number];

/**
 * The subset that is attention-worthy — i.e. counted and filterable.
 *
 * DERIVED by `.filter` from the full list rather than hand-written (the
 * `SalesDocumentAttentionReasonValues` shape), so a value added above cannot
 * silently miss this list or contradict it.
 *
 * **`routed-to-no-destination` is excluded, and that exclusion is the point.**
 * It is a working router making a decision, so on an install that legitimately
 * routes some orders nowhere it would be true of a large, permanent population —
 * exactly the shape that put a red "Invoicing blocked 4,312" on a healthy
 * install under #2100 before `trigger-model-manual` was excluded there. It still
 * renders a per-order badge, neutrally; it is simply never aggregated.
 *
 * One consequence, stated because it is easy to read as a bug: a reason value
 * written by a NEWER release and then rolled back is not counted either, since
 * it cannot match the IN-list built from this array.
 */
export const DestinationRoutingAttentionReasonValues =
  DestinationRoutingBlockReasonValues.filter(
    (reason) => reason !== 'routed-to-no-destination'
  ) as readonly DestinationRoutingBlockReason[];

/**
 * Read-side coercion, mirroring `isFulfillmentBlockReason` / `isSalesDocumentGateBlockReason`.
 *
 * The column is plain `text` with no CHECK constraint, so a value written by a
 * newer release and then rolled back must read as "nothing recognised" rather
 * than widening the union at runtime.
 */
export const isDestinationRoutingBlockReason = (
  value: unknown
): value is DestinationRoutingBlockReason =>
  typeof value === 'string' &&
  (DestinationRoutingBlockReasonValues as readonly string[]).includes(value);

/** What `OrderSyncService` persists: a reason plus PII-free elaboration. */
export interface DestinationRoutingBlock {
  readonly reason: DestinationRoutingBlockReason;
  /**
   * Connection ids and counts ONLY — never buyer data. Rendered verbatim to the
   * operator, so it is bounded by {@link buildDestinationRoutingDetail} rather
   * than interpolating an unbounded router payload into a `text` column.
   */
  readonly detail: string | null;
}

/** How many unresolved ids a detail string names before it summarises the rest. */
const DETAIL_MAX_LISTED_IDS = 10;

/**
 * Build the PII-free detail string for a set of unresolved connection ids.
 *
 * Bounded deliberately: the ids come from a routing decision OpenLinker does not
 * author, and the value is persisted and rendered verbatim, so an unbounded join
 * would let a malformed router payload write an arbitrarily large `text` value
 * onto the order. The total is always stated, so truncation never hides scale.
 */
export const buildDestinationRoutingDetail = (unresolvedIds: readonly string[]): string | null => {
  if (unresolvedIds.length === 0) {
    return null;
  }
  const listed = unresolvedIds.slice(0, DETAIL_MAX_LISTED_IDS);
  const remainder = unresolvedIds.length - listed.length;
  const suffix = remainder > 0 ? `, and ${remainder} more` : '';
  return `${unresolvedIds.length} unresolved destination(s): ${listed.join(', ')}${suffix}`;
};

/** What `OrderSyncService` observed after resolving its destinations. */
export interface DestinationRoutingObservation {
  /**
   * The routing decision's own ids. **`undefined` means no routing filter was
   * supplied** — the unfiltered fan-out every install performs today — and is
   * emphatically not the same as `[]`, which is a router that positively
   * selected nobody. Collapsing the two is the #2397 mistake that would stop
   * destination provisioning everywhere.
   */
  readonly requestedDestinationIds: readonly string[] | undefined;
  /** How many eligible destinations the filter actually resolved to. */
  readonly resolvedCount: number;
  /**
   * Requested ids that resolved to no eligible destination, source echoes
   * already removed. `undefined` when no filter was supplied.
   */
  readonly unresolvedRequestedIds: readonly string[] | undefined;
}

/**
 * Decide which routing narrowing (if any) this run performed.
 *
 * PURE — no I/O, no clock, no injected dependency — so the rule can be asserted
 * exhaustively without a service, matching the `applyPricingRule` /
 * `resolveOfferLifecycle` precedents for a rule that belongs to its own type.
 *
 * `null` means "routing narrowed nothing", which covers both an install with no
 * router at all and a decision every one of whose destinations resolved.
 */
export const deriveDestinationRoutingBlock = (
  observation: DestinationRoutingObservation
): DestinationRoutingBlock | null => {
  const { requestedDestinationIds, resolvedCount, unresolvedRequestedIds } = observation;

  // No routing answer at all — the unfiltered fan-out. Nothing was narrowed, so
  // nothing is reported; this is every order on every install today.
  if (requestedDestinationIds === undefined) {
    return null;
  }

  // A router that positively selected nobody. A DECISION, not a fault.
  if (requestedDestinationIds.length === 0) {
    return { reason: 'routed-to-no-destination', detail: null };
  }

  const unresolved = unresolvedRequestedIds ?? [];

  if (resolvedCount === 0) {
    // Every named id WAS the source connection itself: the filter named
    // destinations, yet none of them survived source-echo exclusion, so there is
    // nothing unreachable to report — a distinct router misconfiguration.
    return unresolved.length === 0
      ? { reason: 'routed-to-source-only', detail: null }
      : {
          reason: 'routed-destinations-unavailable',
          detail: buildDestinationRoutingDetail(unresolved),
        };
  }

  // Some resolved and some did not — the order mirrors to fewer destinations
  // than routing asked for. Log-only before #2704.
  if (unresolved.length > 0) {
    return {
      reason: 'routed-destinations-partially-unavailable',
      detail: buildDestinationRoutingDetail(unresolved),
    };
  }

  return null;
};
