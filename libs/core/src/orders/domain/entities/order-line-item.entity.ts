/**
 * Order Line Item Domain Entity
 *
 * One queryable row per order line (#1985) — the analytics-read-model
 * counterpart to the JSONB `orderSnapshot.items` array. Written transactionally
 * alongside its parent `OrderRecord` so downstream aggregates (top products,
 * per-channel split) never need to expand JSON. Anemic (ADR-011): no behavior,
 * persistence is a thin data-mapper via `OrderRecordRepository`.
 *
 * @module domain/entities
 */
export class OrderLineItem {
  constructor(
    public readonly id: string,
    /** References the parent `OrderRecord.internalOrderId` (no DB-enforced FK — internal ids are TEXT PKs by convention, matching the rest of the schema). */
    public readonly orderRecordId: string,
    /** Position within the order's `items[]` array at persist time — the identity key for idempotent replace-on-reingest. */
    public readonly lineNumber: number,
    /** Internal product id — already resolved by ingestion before `persistOrder` runs. */
    public readonly productId: string,
    /** Internal variant id; `null` for a simple product's synthetic-variant edge case. */
    public readonly variantId: string | null,
    public readonly quantity: number,
    /** Per-unit price in the order's currency; line revenue = `unitPrice × quantity`. */
    public readonly unitPrice: number,
    /** Denormalized from the parent order so a channel-split query never joins back. */
    public readonly sourceConnectionId: string,
    /** Denormalized from the parent order so a date-range query never joins back. `null` when the order carries no `placedAt`. */
    public readonly placedAt: Date | null,
    public readonly createdAt: Date
  ) {}
}
