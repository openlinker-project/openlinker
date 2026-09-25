/**
 * Inventory Sale Decrement Domain Entity (#3453)
 *
 * The durable record that OpenLinker lowered — or deliberately did not lower —
 * one routed work line's stock in the product master that owns it. One row per
 * `idempotencyKey`, so a replay, a re-poll or a job retry finds the row and never
 * decrements a second time, including against a master whose adapter reports
 * `idempotency: 'unsupported'`.
 *
 * Anemic (ADR-011): every state change goes through a named repository method.
 *
 * @module libs/core/src/inventory/domain/entities
 */
import type {
  InventorySaleDecrementReason,
  InventorySaleDecrementStatus,
} from '../types/inventory-sale-decrement.types';

export class InventorySaleDecrement {
  constructor(
    public readonly id: string,
    public readonly idempotencyKey: string,
    public readonly orderId: string,
    public readonly workId: string,
    public readonly orderLineId: string,
    public readonly productId: string,
    public readonly productVariantId: string | null,
    /** `null` only for a line blocked before an owner could be named. */
    public readonly ownerConnectionId: string | null,
    public readonly quantity: number,
    public readonly status: InventorySaleDecrementStatus,
    public readonly reason: InventorySaleDecrementReason | null,
    /** The adapter's own words, verbatim, where there are any. */
    public readonly detail: string | null,
    /** The line sold more than the stock OpenLinker had mirrored for it. */
    public readonly clamped: boolean,
    /** The adapter admitted it cannot dedupe — a manual retry would double-apply. */
    public readonly idempotencyUnsupported: boolean,
    /** The master's available quantity after the write, when it reported one. */
    public readonly resultingQuantity: number | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date
  ) {}
}
