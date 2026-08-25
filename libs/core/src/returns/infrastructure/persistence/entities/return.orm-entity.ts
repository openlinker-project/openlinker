/**
 * Return ORM Entity
 *
 * TypeORM entity for the `returns` table (#2327, ADR-060).
 *
 * **`returns` is a NON-RESERVED keyword in PostgreSQL** (it appears in
 * `CREATE FUNCTION ... RETURNS`), so it is legal as a table name — but only
 * while every reference to it stays double-quoted. TypeORM's default naming
 * strategy quotes identifiers, and the migration quotes it explicitly
 * everywhere; a hand-written raw query must do the same. The name is the one
 * the issue's acceptance criteria state literally, so `return_records` was not
 * substituted for it.
 *
 * The `ol_return_*` primary key is minted in `ReturnRepository.create` via
 * `formatInternalId('Return')` — see that file for why no `CoreEntityTypeValues`
 * member and no `ENTITY_TYPE_ID_PREFIX` override are added.
 *
 * `sourceConnectionId` carries **no FK to `connections`**, and neither does
 * `internalOrderId` to `order_records` — the `refund_records` / `invoice_records`
 * precedent of an indexed reference by value, avoiding cross-table lock
 * coupling. `setup.ts` records the consequence: nothing cascades into this
 * table in the test schema, so it is truncated explicitly.
 *
 * Every index is declared at class level with the SAME NAME the migration uses.
 * The integration harness builds its schema by `synchronize`, not by migration,
 * so an unnamed decorator would produce a hash name there and the two schemas
 * would diverge on exactly the constraints an int-spec asserts.
 *
 * @module libs/core/src/returns/infrastructure/persistence/entities
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('returns')
// #2328's idempotent update-or-create key (DESIGN § 7.3, :784-785). PARTIAL
// because a source that mints no return id at all (Erli) writes NULL here, and
// NULLs must not collide with one another — every id-less return on one
// connection would otherwise be the same return.
@Index('UQ_returns_source_external', ['sourceConnectionId', 'externalReturnId'], {
  unique: true,
  where: '"externalReturnId" IS NOT NULL',
})
@Index('IDX_returns_internal_order_id', ['internalOrderId'])
// The operator's orphan bucket, as an index rather than a scan: this is
// `listOrphans`' exact query, and on a healthy install the matching rows are a
// vanishing fraction of the table. The migration declares `("createdAt" DESC)`;
// the decorator cannot express column ordering, so the synchronize-built index
// is ascending. Same name, same predicate, same columns — the difference is a
// scan-direction optimisation, never a correctness one (pg reads either way).
@Index('IDX_returns_orphans', ['createdAt'], { where: '"internalOrderId" IS NULL' })
@Index('IDX_returns_connection_created', ['sourceConnectionId', 'createdAt'])
export class ReturnOrmEntity {
  @PrimaryColumn({ type: 'text' })
  id!: string;

  @Column({ type: 'uuid' })
  sourceConnectionId!: string;

  @Column({ type: 'text', nullable: true })
  externalReturnId!: string | null;

  /**
   * NULLABLE BY DESIGN — an orphan return persists and blocks every downstream
   * trigger. See `ReturnRecord`'s docblock for the full argument.
   */
  @Column({ type: 'text', nullable: true })
  internalOrderId!: string | null;

  @Column({ type: 'varchar', length: 32 })
  origin!: string;

  /** The source's own status word, verbatim. No mapping table, by design. */
  @Column({ type: 'text', nullable: true })
  rawStatus!: string | null;

  /**
   * The source payload as received.
   *
   * **Known gap, deliberately landed and named rather than silently carried:**
   * a returns payload can contain buyer PII (name, address, contact), and this
   * column has no `OL_STORE_PII` parity with `customer_projections` — nothing
   * redacts or hashes it. That is a property of INGESTION, which is #2330's
   * concern and not this slice's: the column must exist before there is
   * anything to redact in it, and the redaction policy has to be decided
   * against a real payload shape rather than guessed at here. Until then, treat
   * this column as PII-bearing.
   */
  @Column({ type: 'jsonb', nullable: true })
  rawPayload!: Record<string, unknown> | null;

  // Four INDEPENDENT facts, not a status ladder — none excludes another.
  @Column({ type: 'timestamptz', nullable: true })
  openedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  authorizedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  declinedAt!: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  closedAt!: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
