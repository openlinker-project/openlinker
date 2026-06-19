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
 *   1. `delivered`   — any shipment delivered
 *   2. `dispatched`  — any shipment in `generated | dispatched | in-transit`
 *   3. `failed`      — shipments exist AND all are terminal `failed | cancelled`
 *   4. `not-shipped` — the residual: no shipments, or only `draft` (also NULL)
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
