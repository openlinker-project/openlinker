/**
 * Fulfillment Hold ORM Entity (#2392, DESIGN §5.2)
 *
 * First-class hold rows at the WORK grain. Released, never deleted — the row is
 * the audit record of why work was suspended.
 *
 * **There is no `UQ … WHERE "releasedAt" IS NULL`**, unlike `order_holds`.
 * At-most-one-open is the ORDER grain's rule; DESIGN §5.2 allows **stacking up
 * to ten** at this grain ("Shopify's ≤10 is at the *fulfillment* grain, where
 * this design also allows stacking"). The cap is enforced in
 * `FulfillmentWorkRepository.placeHold`, not here — a partial unique index can
 * only express N=1, and a trigger (the only DB construct that could express
 * N>1) would hold in production and silently NOT in the `synchronize`-built
 * test schema.
 *
 * `fulfillmentWorkId` carries a real FK — `fulfillment_works(id) ON DELETE
 * CASCADE`, migration-only, no `@ManyToOne` — for the same reason the line table
 * does: a hold is meaningless without its work.
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

@Entity('fulfillment_holds')
// Serves both the active-hold read and the >=10 cap count. Partial: a released
// hold is exactly the row neither of those cares about.
@Index('IDX_fulfillment_holds_work_active', ['fulfillmentWorkId'], {
  where: '"releasedAt" IS NULL',
})
// EXACTLY one actor (`<>`, i.e. XOR), not at least one. A row claiming both a
// human and a service placed it is not a richer record, it is an unanswerable
// audit question. Copied in shape and in name-discipline from
// `CHK_order_holds_actor`.
@Check(
  'CHK_fulfillment_holds_actor',
  '("placedByUserId" IS NOT NULL) <> ("placedByService" IS NOT NULL)'
)
export class FulfillmentHoldOrmEntity {
  /**
   * The PK constraint is NAMED to match the migration's `PK_fulfillment_holds`.
   *
   * Without `primaryKeyConstraintName`, `synchronize` mints a hash name
   * (`PK_673ee84980642c53c5a5234501e`) while the migration uses the readable
   * one — the two schemas then differ on a constraint name, which is precisely
   * the drift `fulfillment-work-migration-parity.int-spec.ts` exists to catch,
   * and which it did catch. Same discipline as the named `@Check`/`@Index`
   * decorators on these entities.
   */
  @PrimaryGeneratedColumn('uuid', { primaryKeyConstraintName: 'PK_fulfillment_holds' })
  id!: string;

  @Column({ type: 'text' })
  fulfillmentWorkId!: string;

  /**
   * `HoldReason` verbatim, stored as `varchar(64)` — no PG enum and no CHECK,
   * the same call `order_holds.reason` makes: a database-level list would cost a
   * migration per value and turn a rollback past a widened vocabulary into a
   * hard write failure rather than a coercion miss.
   *
   * Unlike `order_holds`, this column is **cast rather than narrowed** on read.
   * Narrowing needs `isHoldReason`, a VALUE import from a sibling context, which
   * `barrel-purity.spec.ts` forbids from a registered zero-sibling-edge leaf
   * unconditionally. See `domain/types/fulfillment-hold.types.ts`.
   */
  @Column({ type: 'varchar', length: 64 })
  reason!: string;

  @Column({ type: 'text', nullable: true })
  note!: string | null;

  @Column({ type: 'text', nullable: true })
  placedByUserId!: string | null;

  @Column({ type: 'text', nullable: true })
  placedByService!: string | null;

  @Column({ type: 'timestamptz' })
  placedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  releasedAt!: Date | null;

  @Column({ type: 'text', nullable: true })
  releasedByUserId!: string | null;

  @Column({ type: 'text', nullable: true })
  releaseNote!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
