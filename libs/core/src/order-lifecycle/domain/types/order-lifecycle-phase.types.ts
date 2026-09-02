/**
 * Order Lifecycle Phase (#2305, ADR-059)
 *
 * The nine-value DERIVED answer to the operator's actual question — "what is
 * this order waiting on, and who holds it up". Nothing persists a phase: it is
 * recomputed from facts each of which has its own grain and its own single
 * writer (ADR-059 Decision). This file owns only the vocabulary and its
 * precedence; the derivation itself is #2307 and the repository `CASE` twin
 * that must mirror this order is #2309.
 *
 * **Precedence is highest-wins, and the array order IS the ordinal.**
 * `OrderLifecyclePhaseValues` is declared in precedence order so that
 * `ORDER_LIFECYCLE_PHASE_PRECEDENCE` below, the pure derivation (#2307) and the
 * SQL `CASE` (#2309) never restate it a second, third and fourth time — the
 * drift ADR-059's mirror-check script exists to catch.
 *
 * | # | phase                  | why it outranks what follows                                 |
 * |---|------------------------|--------------------------------------------------------------|
 * | 1 | `cancelled`            | a cancel wins over everything; a cancel-after-dispatch shows the shipment as contradicting DETAIL, not as a competing phase |
 * | 2 | `vendor_authoritative` | posture B: the vendor holds lifecycle authority and reported a label OL cannot classify, so OL renders it verbatim rather than fabricating a phase |
 * | 3 | `delivered`            | a terminal observed fulfilment outcome outranks any in-flight reading |
 * | 4 | `in_transit`           | the parcel is moving; holds/amendments below are no longer actionable against it |
 * | 5 | `fulfillment_failed`   | a failed fulfilment is a fact about work already attempted, above intentions not yet acted on |
 * | 6 | `held`                 | a hold is a DECISION someone made; an amendment is only a request — so a hold outranks `amending` |
 * | 7 | `amending`             | an amendment is in flight (ADR-044 `PENDING`/`REQUESTED`), i.e. an OL-authored intention |
 * | 8 | `blocked`              | ingest gaps (unmapped variant, source-deleted); below OL-authored intentions because it describes OL's own incompleteness |
 * | 9 | `ready`                | residual — nothing above applies |
 *
 * **`vendor_authoritative` has no producer until Wave 4** (posture-B adapters
 * declaring `LifecycleAuthorityProvider`). That is deliberate, not dead code:
 * the phase is contract, and a vocabulary that gains a value later forces every
 * mirror — FE, SQL `CASE`, mirror-check script — to be revised in lockstep.
 * Declaring the full nine now costs one unreachable branch; declaring eight now
 * costs a coordinated widening later.
 *
 * **Two deliberate absences** (ADR-059 / design §6.2), recorded so a later
 * reader does not "complete" the union:
 * - **no `partially_*` phase** — partial shipment/cancellation is a QUANTITY
 *   fact at line grain, and a phase that encoded it would need one value per
 *   combination. Counters answer it; the phase does not.
 * - **no `returned` phase** — OL observes returns as a read-only source
 *   projection and owns no return state any source reports back, so a
 *   `returned` phase would be a state OL cannot author or defend.
 *
 * **This is a SECOND ORTHOGONAL PARTITION beside `OrderHealth`, never a sixth
 * health bucket** (ADR-059). `OrderHealth` partitions "is something wrong";
 * this partitions "what stage is it at". A held order is usually also
 * `synced` — folding one into the other would either double-count or hide a
 * sync failure behind a lifecycle one, the same trap #2100 documented.
 *
 * @module libs/core/src/order-lifecycle/domain/types
 * @see docs/architecture/adrs/059-order-lifecycle-derived-phase.md
 */

/**
 * The nine phases, DECLARED IN PRECEDENCE ORDER (highest first).
 *
 * Reordering this array silently changes the derivation's outcome once #2307
 * lands, because the ordinal below is computed from it. Treat the order as
 * contract, not as presentation.
 */
export const OrderLifecyclePhaseValues = [
  'cancelled',
  'vendor_authoritative',
  'delivered',
  'in_transit',
  'fulfillment_failed',
  'held',
  'amending',
  'blocked',
  'ready',
] as const;

export type OrderLifecyclePhase = (typeof OrderLifecyclePhaseValues)[number];

/**
 * Highest-wins ordinal, 1..9, derived from the declaration order above.
 *
 * Exported (rather than left private to the derivation) so #2307's pure
 * function and #2309's SQL `CASE` both read the ordinal from ONE place. A
 * lower number wins: the minimum over the applicable phases is the derivation.
 */
export const ORDER_LIFECYCLE_PHASE_PRECEDENCE: Record<
  OrderLifecyclePhase,
  number
> = Object.freeze(
  Object.fromEntries(
    OrderLifecyclePhaseValues.map((phase, index) => [phase, index + 1]),
  ) as Record<OrderLifecyclePhase, number>,
);

/**
 * Coerce an untrusted value (a persisted string, an API query parameter) to the
 * union. Pure; deliberately NO safe default, unlike `readLifecycleAuthority` —
 * there is no phase that is safe to assume, and inventing `ready` for an
 * unrecognised value would report "nothing to do" about an order in an unknown
 * state. A caller that needs a fallback picks one in context.
 */
export function isOrderLifecyclePhase(
  value: unknown,
): value is OrderLifecyclePhase {
  return (
    typeof value === 'string' &&
    (OrderLifecyclePhaseValues as readonly string[]).includes(value)
  );
}
