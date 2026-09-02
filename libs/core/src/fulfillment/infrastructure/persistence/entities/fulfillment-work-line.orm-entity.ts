/**
 * Fulfillment Work Line ORM Entity (#2392, ADR-054, DESIGN §5.2)
 *
 * One order line's participation in one work object. Lines carry **quantity
 * counters, never per-line statuses** — "3 of 5 shipped" is not a status, and a
 * status axis cannot express partial fulfilment at all.
 *
 * **The PK is a plain uuid, not an `ol_*` internal id.** A line is never
 * referenced from outside its aggregate and has no external counterpart to map,
 * so minting a prefixed internal id would buy nothing (the `return_lines` /
 * `refund_records` precedent).
 *
 * `fulfillmentWorkId` carries the ONE foreign key this table wants —
 * `fulfillment_works(id) ON DELETE CASCADE` — declared in the **migration only**,
 * with no `@ManyToOne` relation (the `return_lines` / `category_mappings` /
 * `inventory_locations` precedent). A line is a part of its work, not a peer of
 * it; deleting a work must take its lines and nothing else owns them.
 *
 * There is deliberately **no separate index on `fulfillmentWorkId`**: the
 * leading column of `UQ_fulfillment_work_lines_work_order_line` already serves
 * every `WHERE "fulfillmentWorkId" = ?` lookup and the FK's own referential
 * check, so a second index would be pure write amplification.
 *
 * `orderLineId` gets no FK because none is possible — see the column.
 *
 * @module libs/core/src/fulfillment/infrastructure/persistence/entities
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

@Entity('fulfillment_work_lines')
// One order line participates in one work object exactly once. That pair IS the
// line's identity and is the key `recordLineProgress` updates on.
@Index('UQ_fulfillment_work_lines_work_order_line', ['fulfillmentWorkId', 'orderLineId'], {
  unique: true,
})
// The counter invariant, expressed in the DB rather than in a domain method so
// that no caller — including one that bypasses this context — can persist an
// impossible line. Declared class-level with the SAME NAME as the migration's
// constraint (the `return_lines` / `offer_commercial_snapshots` precedent): the
// integration harness builds its schema by `synchronize`, so an anonymous
// @Check would produce a hash name there and the int-spec would be asserting a
// constraint the migration-built schema does not have under that name.
//
// This is the exact twin of the pure `checkFulfillmentWorkLineCapacity`
// (`domain/types/fulfillment-work.types.ts`), which #2392 widened with the three
// non-negativity clauses so that the function and this constraint are ONE rule.
// They must move together — a fixture accepted by one and rejected by the other
// is the drift a vocabulary leaf exists to prevent.
@Check(
  'CHK_fulfillment_work_lines_capacity',
  '"totalQuantity" >= 0 AND "fulfilledQuantity" >= 0 AND "cancelledQuantity" >= 0 AND "fulfilledQuantity" + "cancelledQuantity" <= "totalQuantity"'
)
export class FulfillmentWorkLineOrmEntity {
  /**
   * The PK constraint is NAMED to match the migration's `PK_fulfillment_work_lines`.
   *
   * Without `primaryKeyConstraintName`, `synchronize` mints a hash name
   * (`PK_673ee84980642c53c5a5234501e`) while the migration uses the readable
   * one — the two schemas then differ on a constraint name, which is precisely
   * the drift `fulfillment-work-migration-parity.int-spec.ts` exists to catch,
   * and which it did catch. Same discipline as the named `@Check`/`@Index`
   * decorators on these entities.
   */
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_fulfillment_work_lines' })
  id!: string;

  @Column({ type: 'text' })
  fulfillmentWorkId!: string;

  /**
   * NULLABLE-free but un-FK-able by construction: `order_records` has no lines
   * table — items live inside the `orderSnapshot` jsonb — so this is a by-value
   * reference INTO a document. The same posture `ReturnLine.resolvedOrderLineId`
   * holds.
   */
  @Column({ type: 'text' })
  orderLineId!: string;

  /** By-value reference to `product_variants.id`. No FK, for the reason above. */
  @Column({ type: 'text' })
  productVariantId!: string;

  @Column({ type: 'integer' })
  totalQuantity!: number;

  /** Written by progress ingress (#2400), never by a create or a re-save. */
  @Column({ type: 'integer', default: 0 })
  fulfilledQuantity!: number;

  /** Likewise #2400's. */
  @Column({ type: 'integer', default: 0 })
  cancelledQuantity!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
