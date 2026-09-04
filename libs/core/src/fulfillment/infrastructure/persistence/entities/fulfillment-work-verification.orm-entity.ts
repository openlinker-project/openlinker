/**
 * Fulfillment Work Verification ORM Entity (#2418, spec § 2.5, decisions D18/D19/D20)
 *
 * One row per unit verified into a box at the pack bench. Append-only: a reopen
 * VOIDS rows, it never deletes them.
 *
 * This is the ledger #2413's `fulfillment-work.orm-entity.ts` named when it
 * said of `packedByUserId` that *"a reader must NOT take this field as a
 * complete account of who handled the box — the verification ledger holds the
 * rest"*. `packedByUserId` is the LAST verifier (D13); these rows are every
 * contributor.
 *
 * ## The columns that are ABSENT are the D20 guarantee
 *
 * There is no `source`, no `barcode`, no `scanned`, no `manual`, no
 * `confirmationMethod`. *"Manual confirmation is recorded identically to a
 * scan"* is therefore a property of the schema rather than of a convention, and
 * `fulfillment-verification-indistinguishable.spec.ts` asserts this exact column
 * list so that adding one is a deliberate act that fails a test named for the
 * decision. Marking a hand-confirmed line creates a stigma, and stigma drives
 * the workaround the system cannot see — scanning a second unit of the same SKU
 * twice, after which the parcel closes looking perfectly verified.
 *
 * ## `quantity` is likewise absent, deliberately
 *
 * One row is one unit, because one row is one physical gesture. A quantity
 * column would let a single row stand for three units and destroy the property
 * `gestureId` exists to give: that one physical action is recorded exactly once
 * and a legitimate second scan is a second unit (story G3).
 *
 * ## Foreign keys
 *
 * `fulfillmentWorkId` carries the one FK this table wants —
 * `fulfillment_works(id) ON DELETE CASCADE` — declared in the **migration
 * only**, with no `@ManyToOne` relation (the `fulfillment_work_lines` /
 * `return_lines` precedent). `workLineId` gets none: the cascade from the work
 * already reaches every row, and a second FK would add a lock edge on the hot
 * verification write for a referential check the first one already implies.
 *
 * @module libs/core/src/fulfillment/infrastructure/persistence/entities
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('fulfillment_work_verifications')
// The idempotency key, and it IS the enforcement — a `SELECT` then `INSERT`
// enforces nothing at READ COMMITTED, because the conflicting row is a phantom
// that cannot be locked before it exists (the `fulfillment_progress_claims`
// reasoning, one table over). Scoped to the work rather than global: a gesture
// id is minted per bench session and only ever offered against one parcel, and
// a global unique index would make an id collision across two benches look like
// a duplicate scan.
@Index('UQ_fulfillment_work_verifications_gesture', ['fulfillmentWorkId', 'gestureId'], {
  unique: true,
})
// The count read, and the only read there is. Partial on the ACTIVE rows because
// a voided row is history: it must leave the index the moment a reopen writes
// `voidedAt`, which is the same "rows leaving the index is the mechanism"
// argument `UQ_order_changes_open_target` records.
@Index('IDX_fulfillment_work_verifications_active', ['fulfillmentWorkId', 'workLineId'], {
  where: '"voidedAt" IS NULL',
})
export class FulfillmentWorkVerificationOrmEntity {
  /**
   * NAMED to match the migration's `PK_fulfillment_work_verifications` — without
   * it `synchronize` mints a hash name while the migration uses the readable
   * one, which is exactly the drift `fulfillment-work-migration-parity.int-spec.ts`
   * exists to catch and has caught before.
   */
  @PrimaryGeneratedColumn('uuid', {
    primaryKeyConstraintName: 'PK_fulfillment_work_verifications',
  })
  id!: string;

  @Column({ type: 'text' })
  fulfillmentWorkId!: string;

  /** `fulfillment_work_lines.id`. By-value; see the module note on foreign keys. */
  @Column({ type: 'uuid' })
  workLineId!: string;

  /**
   * #2416's client-minted, storage-durable per-gesture id, CONSUMED here.
   *
   * `text` rather than `uuid`: the browser mints a `crypto.randomUUID()` where
   * it can and a counter-based fallback where it cannot, and refusing the
   * fallback at the column would make the bench stop recording on exactly the
   * older devices a warehouse floor runs.
   */
  @Column({ type: 'text' })
  gestureId!: string;

  /**
   * Who verified it. `uuid`, matching `fulfillment_works.packedByUserId` and for
   * the same reason it diverges from `fulfillment_holds.placedByUserId`: this
   * value is copied into that column on the closing verification, and a `text`
   * source can hold a value the target cannot store.
   *
   * No FK to `users`: a dangling id from a deleted user is the honest outcome
   * for an audit fact, and this context carries cross-aggregate references by
   * value throughout.
   */
  @Column({ type: 'uuid', nullable: true })
  verifiedByUserId!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  verifiedAt!: Date;

  /**
   * When a reopen took this unit back out of the box (E6), or `null` while it
   * counts.
   *
   * This pair IS the reopen audit — *"the reopen is recorded with who and
   * when"*. No `lastReopenedAt` column exists on the work, because a closed
   * parcel by definition has a full ledger, so a reopen always writes rows; a
   * second record of the same fact would be the cost this context already
   * refuses for an index nothing reads.
   */
  @Column({ type: 'timestamptz', nullable: true })
  voidedAt!: Date | null;

  @Column({ type: 'uuid', nullable: true })
  voidedByUserId!: string | null;
}
