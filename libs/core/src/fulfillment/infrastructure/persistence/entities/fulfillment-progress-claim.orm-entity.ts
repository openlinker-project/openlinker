/**
 * Fulfillment Progress Claim ORM Entity (#2400)
 *
 * One row per `(workId, idempotencyKey)` — the at-most-once gate for progress
 * ingestion. See `FulfillmentProgressClaimRepositoryPort` for why the
 * uniqueness is unconditional rather than partial.
 *
 * **The composite PRIMARY KEY is the only uniqueness declaration on this
 * table, and the repository depends on that being true** — see the repository
 * docblock for the `orIgnore()` precondition it carries.
 *
 * **The FK to `fulfillment_works` lives in the MIGRATION only, with no
 * `@ManyToOne` here** — the convention `FulfillmentWorkLineOrmEntity` and
 * `FulfillmentHoldOrmEntity` already follow in this table family. It is not
 * cosmetic: the parity spec asserts that asymmetry explicitly (`synchronize`
 * builds no FK), so declaring a relation here would break it. `ON DELETE
 * CASCADE` is still the semantics that ships — a claim is meaningless without
 * its work row, and an orphan would let a re-created work id inherit a stale
 * suppression.
 *
 * Every index and constraint here is NAMED, matching the migration exactly. The
 * integration harness builds schema by `synchronize` (`migrationsRun: false`),
 * so an anonymous decorator gets a TypeORM hash name and diverges silently from
 * production — the drift #2392's parity spec caught on its first green run.
 *
 * @module libs/core/src/fulfillment/infrastructure/persistence/entities
 */
import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('fulfillment_progress_claims')
@Index('IDX_fulfillment_progress_claims_claimed_at', ['claimedAt'])
export class FulfillmentProgressClaimOrmEntity {
  /** References `fulfillment_works.id`. FK declared in the migration (see above). */
  @PrimaryColumn({ type: 'text', primaryKeyConstraintName: 'PK_fulfillment_progress_claims' })
  workId!: string;

  /** The executor's own key for this reported fact. Opaque to OpenLinker. */
  @PrimaryColumn({ type: 'text', primaryKeyConstraintName: 'PK_fulfillment_progress_claims' })
  idempotencyKey!: string;

  @Column({ type: 'uuid' })
  connectionId!: string;

  /**
   * The reported kind, for forensics only.
   *
   * Deliberately `text` and NOT constrained to `FulfillmentProgressEventKind`:
   * this column is evidence of what arrived, and a CHECK would make a future
   * kind (`awaiting_wave`) a migration before it is a feature.
   */
  @Column({ type: 'text' })
  eventKind!: string;

  @Column({ type: 'timestamptz' })
  claimedAt!: Date;

}
