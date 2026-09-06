/**
 * Shipment Line ORM Entity (#2727, `DECISION-oms-fulfilment-grain` option C)
 *
 * One order line's participation in one shipment. Lines carry **quantity
 * counters, never per-line statuses** — the `fulfillment_work_lines` /
 * `return_lines` discipline: "3 of 5 shipped" is not a status.
 *
 * **`orderId` is a per-LINE fact and is not redundant with `shipments.orderId`.**
 * See `shipment-line.types.ts` for the full reasoning: a consolidated parcel
 * carries units from more than one order, and deriving the line's order from
 * its shipment header makes those units unrepresentable rather than merely
 * awkward.
 *
 * **The PK is a plain uuid**, matching `fulfillment_work_lines` / `return_lines`:
 * a line is never referenced from outside its aggregate and has no external
 * counterpart to map, so minting an `ol_*` internal id would buy nothing.
 *
 * `shipmentId` carries the ONE foreign key this table wants —
 * `shipments(id) ON DELETE CASCADE` — declared in the **migration only**, with
 * no `@ManyToOne` (the `fulfillment_work_lines` / `return_lines` precedent). A
 * line is a part of its shipment, not a peer of it. `orderId`, `lineId` and
 * `productVariantId` get no FK: `order_records` has no lines table at all
 * (items live inside the `orderSnapshot` jsonb), so `lineId` could not have one
 * in any case.
 *
 * **Every index and check is declared here under the SAME NAME the migration
 * uses.** The integration harness builds its schema by `synchronize`, so a
 * constraint present only in the migration would hold in production and
 * silently NOT in tests. Both tables join
 * `fulfillment-work-migration-parity.int-spec.ts` for exactly that reason.
 *
 * @module libs/core/src/shipping/infrastructure/persistence/entities
 */
import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('shipment_lines')
// The line's identity, and the key every upsert conflicts on. `orderId` sits
// between the two on purpose — it is part of the identity (option C), not a
// payload column. Its leading column serves every `WHERE "shipmentId" = ?` read
// AND the CASCADE FK's referential check, so no separate index on that column.
@Index('UQ_shipment_lines_shipment_order_line', ['shipmentId', 'orderId', 'lineId'], {
  unique: true,
})
// The derivation read: "how many units of this order have shipped / arrived".
// Not servable by the unique index above, which leads on `shipmentId`.
@Index('IDX_shipment_lines_order_line', ['orderId', 'lineId'])
// The counter ordering invariant, expressed in the DB rather than in a domain
// method so that no caller — including one that bypasses this context — can
// persist an impossible line. Declared class-level under the SAME NAME as the
// migration's constraint: `synchronize` would otherwise mint a hash name and
// the parity spec would be comparing a constraint the migration-built schema
// does not have under that name.
//
// This is the exact twin of the pure `checkShipmentLineCapacity`
// (`domain/types/shipment-line.types.ts`). They are ONE rule and must move
// together — a row one accepts and the other rejects is precisely the drift the
// parity spec exists to catch.
//
// `"cancelledQuantity" <= "shippedQuantity"` is the load-bearing clause: it is
// what makes the NET shipped quantity non-negative by construction, and that
// net is the number every derivation reads.
//
// `"shippedQuantity" <= "quantity"` is deliberately ABSENT — see the pure
// twin's docblock. Re-ingestion rewrites `orderSnapshot` wholesale and a
// dispatch retry reuses the same shipment row, so both paths legitimately
// produce a shipped total above the frozen `quantity`; the clause would raise
// inside a best-effort catch and silently stop the read model converging.
@Check(
  'CHK_shipment_lines_capacity',
  '"quantity" >= 0 AND "shippedQuantity" >= 0 AND "deliveredQuantity" >= 0 AND "cancelledQuantity" >= 0 AND "deliveredQuantity" <= "shippedQuantity" AND "cancelledQuantity" <= "shippedQuantity"'
)
export class ShipmentLineOrmEntity {
  /**
   * The PK constraint is NAMED to match the migration's `PK_shipment_lines`.
   *
   * Without `primaryKeyConstraintName`, `synchronize` mints a hash name while
   * the migration uses the readable one — and the parity spec's `stripPkName`
   * carve-out would then SWALLOW the difference, so the name would go unchecked
   * rather than fail loudly. Same discipline as `FulfillmentWorkLineOrmEntity`,
   * which records that the spec caught exactly this.
   */
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_shipment_lines' })
  id!: string;

  @Column({ type: 'text' })
  shipmentId!: string;

  /** See the class docblock — a per-line fact, deliberately not derived. */
  @Column({ type: 'text' })
  orderId!: string;

  /**
   * The source-supplied `orderSnapshot.items[].id`. Un-FK-able by construction:
   * `order_records` has no lines table. The same by-value posture
   * `FulfillmentWorkLine.orderLineId` and `ReturnLine.resolvedOrderLineId` hold,
   * and the same value `reservations.orderLineId` already keys on.
   */
  @Column({ type: 'text' })
  lineId!: string;

  /**
   * By-value reference to `product_variants.id`, or null when the order line
   * resolved to no variant. No FK, for the reason above.
   */
  @Column({ type: 'text', nullable: true })
  productVariantId!: string | null;

  /**
   * Units this shipment UNDERTAKES for this line, as OL understood the order at
   * the time. Written once at line creation and never rewritten, so a later
   * order edit cannot retroactively restate what an already-shipped parcel
   * undertook.
   *
   * PROVENANCE, not a bound: nothing constrains `shippedQuantity` against it —
   * see the `@Check` above for the two ordinary paths that would violate such a
   * constraint.
   */
  @Column({ type: 'integer' })
  quantity!: number;

  /** Folded from this line's `ship` acts. Never incremented in place. */
  @Column({ type: 'integer', default: 0 })
  shippedQuantity!: number;

  /** Folded from this line's `deliver` acts. */
  @Column({ type: 'integer', default: 0 })
  deliveredQuantity!: number;

  /** Folded from this line's `cancel` acts. */
  @Column({ type: 'integer', default: 0 })
  cancelledQuantity!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
