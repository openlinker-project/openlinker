/**
 * Order Record Domain Entity
 *
 * Represents a persisted order record in OpenLinker. Stores minimal order data
 * (OrderRecord + SyncState) for retry/debug support without re-polling source systems.
 * Order snapshot is PII-aware (respects OL_STORE_PII configuration).
 *
 * @module domain/entities
 */
import type { OrderRecordStatus } from '../types/order-record.types';
import type { OrderSyncStatus, SyncAttempt } from '../types/order-sync.types';
import { PaymentStatusValues } from '../types/payment-status.types';
import type { PaymentStatus } from '../types/payment-status.types';
import type { CodToCollect } from '../types/cod-to-collect.types';
import type { FulfillmentRollupState } from '../types/order-fulfillment.types';
import { OrderStatusValues } from '../types/order.types';
import type { OrderStatus } from '../types/order.types';

export type { OrderSyncStatus, SyncAttempt } from '../types/order-sync.types';

/**
 * Order Record Domain Entity
 *
 * Stores minimal order data for retry/debug support. Order snapshot contains
 * the full order data (PII-aware), and syncStatus tracks sync state per destination.
 *
 * recordStatus='awaiting_mapping': snapshot holds raw IncomingOrder (external refs, no internal IDs).
 * recordStatus='ready': snapshot holds resolved Order (internal product/variant IDs).
 *
 * `syncAttempts` is the per-destination append-only history; the constructor
 * defaults it to `[]` so existing call sites that pre-date the column compile
 * unchanged (the field is hydrated from the JSONB column by the repository).
 */
export class OrderRecord {
  constructor(
    public readonly internalOrderId: string,
    public readonly customerId: string | null,
    public readonly sourceConnectionId: string,
    public readonly sourceEventId: string | null,
    public readonly orderSnapshot: Record<string, unknown>,
    public readonly syncStatus: OrderSyncStatus[],
    public readonly recordStatus: OrderRecordStatus,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
    public readonly syncAttempts: SyncAttempt[] = [],
    /**
     * Derived marketplace dispatch (ship-by) deadline (#927) — the `.to` of the
     * source dispatch window, denormalized to a top-level column so the orders
     * list can sort/filter on the SLA without parsing the snapshot. `null` when
     * the source exposes no dispatch SLA. Re-derived on every persist so a
     * re-pulled order with a changed window stays fresh.
     */
    public readonly dispatchByAt: Date | null = null,
    /**
     * Per-order fulfillment rollup (#1108) — a denormalized projection of the
     * order's shipment lifecycle, pushed from the shipping context via
     * `updateFulfillmentState`. `null` ≡ `not-shipped` (no backfill needed).
     * Lets the orders list show/filter "has this shipped?" without reaching
     * into the shipping context.
     */
    public readonly fulfillmentState: FulfillmentRollupState | null = null,
  ) {}

  /**
   * Typed, fail-safe read of the order's neutral payment status (#928) from the
   * snapshot. Pure derivation of an already-loaded field (ADR-011): no I/O, no
   * mutation. Centralises the `orderSnapshot.paymentStatus` key + narrowing in
   * the owning context so cross-context consumers (e.g. the #938 shipping
   * dispatch gate) bind to a typed contract rather than the snapshot's internal
   * JSON layout. Returns `undefined` when the source didn't populate payment
   * (graceful degradation — PrestaShop / legacy orders) or the stored value
   * isn't a recognised status.
   */
  get paymentStatus(): PaymentStatus | undefined {
    const value = this.orderSnapshot.paymentStatus;
    return typeof value === 'string' && (PaymentStatusValues as readonly string[]).includes(value)
      ? (value as PaymentStatus)
      : undefined;
  }

  /**
   * Typed, fail-safe read of the marketplace-sourced COD collect amount (#1435)
   * from the snapshot. Pure derivation of an already-loaded field (ADR-011): no
   * I/O, no mutation. Mirrors the {@link paymentStatus} getter — centralises the
   * `orderSnapshot.codToCollect` key + narrowing so the shipping dispatch gate
   * binds to a typed contract, not the JSON layout. Returns `undefined` when the
   * source didn't supply it (prepaid orders, legacy/non-Allegro COD) or the
   * stored value isn't a well-formed `{ amount, currency }` pair.
   */
  get codToCollect(): CodToCollect | undefined {
    const value = this.orderSnapshot.codToCollect;
    if (typeof value !== 'object' || value === null) {
      return undefined;
    }
    const { amount, currency } = value as Record<string, unknown>;
    return typeof amount === 'string' && typeof currency === 'string'
      ? { amount, currency }
      : undefined;
  }

  /**
   * Typed, fail-safe read of the order's neutral lifecycle status (#1596) from
   * the snapshot. Pure derivation of an already-loaded field (ADR-011): no I/O,
   * no mutation. Mirrors {@link paymentStatus} — lets the #1596 auto-issuance
   * race gate re-check the order's LIVE status against a typed contract rather
   * than the snapshot's internal JSON layout. Returns `undefined` when the
   * source didn't populate status or the stored value isn't a recognised
   * `OrderStatus`.
   */
  get status(): OrderStatus | undefined {
    const value = this.orderSnapshot.status;
    return typeof value === 'string' && (OrderStatusValues as readonly string[]).includes(value)
      ? (value as OrderStatus)
      : undefined;
  }
}
