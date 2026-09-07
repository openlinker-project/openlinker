/**
 * Order Fulfillment Rollup Types
 *
 * A per-order rollup of the order's shipment lifecycle (#1108), denormalized
 * onto `order_records.fulfillmentState` so the orders list can show "has this
 * shipped?" and filter/sort on it without reaching into the shipping context.
 *
 * **Distinct from `FulfillmentStatus`** (`fulfillment-status-snapshot.types.ts`):
 * that union is the destination OMP's read-back view (#834). This one is OL's
 * own rollup over the `Shipment` rows it owns. The rollup derivation lives in
 * the shipping context (it owns shipment status) and is pushed onto the order
 * via `IOrderRecordService.updateFulfillmentState`; orders never imports
 * shipping.
 *
 * **Shared spelling with the FE**: the values intentionally match the FE
 * `deriveFulfillment` output (`apps/web/.../order-health.ts`) so no translation
 * layer is needed. The FE-only `unavailable` (shipping-capability absent) is a
 * render concern and is deliberately NOT part of this stored vocabulary.
 *
 * **NULL semantics**: a NULL column value is treated as `not-shipped` in every
 * derivation, filter, and summary — so existing orders are correct-by-default
 * with no backfill; an order with prior shipments converges to its true rollup
 * on the next shipment mutation or the reconciliation poll.
 *
 * @module libs/core/src/orders/domain/types
 */

/**
 * Per-order fulfillment rollup values (#1108).
 *
 * PRECEDENCE (highest wins) — the shipping-side `deriveFulfillmentRollup`
 * helper and the orders SQL filter/summary must both encode exactly this:
 *   1. `dispatched`  — any shipment in `generated | dispatched | in-transit`
 *   2. `delivered`   — any shipment delivered, AND (when line-grain coverage is
 *                      known) every ordered unit is accounted for
 *   3. `dispatched`  — a delivered shipment whose coverage falls short
 *   4. `failed`      — shipments exist AND all are terminal `failed | cancelled`
 *   5. `not-shipped` — the residual: no shipments, or only `draft` (also NULL)
 *
 * **Revised by #2727.** The old rule led with `delivered` — *any* delivered
 * shipment won — so an order with one parcel delivered and one still in transit
 * reported as fully delivered. Two things changed: an in-progress shipment now
 * OUTRANKS a delivered sibling (rule 1, needing no line data), and a delivered
 * order whose `shipment_lines` coverage falls short of what it ordered is
 * demoted to `dispatched` (rule 3). `dispatched` is the honest approximation
 * because this vocabulary has no `partial` value — adding one would need this
 * union's SQL twins, the FE `deriveFulfillment` and every label map, so it is
 * named as a deliberate omission rather than smuggled in.
 *
 * Coverage is OPTIONAL at the derivation, and ABSENT means "no line data"
 * (a pre-backfill install, or a snapshot with no items) — never "zero
 * delivered", which would demote every such order.
 */
export const FulfillmentRollupStateValues = [
  'not-shipped',
  'dispatched',
  'delivered',
  'failed',
] as const;

/**
 * Per-order fulfillment rollup type (#1108).
 */
export type FulfillmentRollupState = (typeof FulfillmentRollupStateValues)[number];

/**
 * Convenience: the stored-column type. `null` ≡ `not-shipped` (see module doc).
 */
export type FulfillmentRollupStateOrNull = FulfillmentRollupState | null;
