/**
 * Sales-Document Rule ORM Entity (#2170)
 *
 * `country` is `varchar(8)` rather than a strict 2-char ISO code so it can
 * also hold the `*` "Rest of world" pseudo-country literal. `conditionsHash`
 * is computed and stamped by the application layer (never a DB generated
 * column — see the service's own doc comment on why no DB trigger ships),
 * with a plain unique index guarding the exact-duplicate-insert case; the
 * semantic overlapping-date-range-with-a-different-connection guard is a
 * transaction-scoped application check, since Postgres cannot express
 * "overlapping date range" in a plain unique index.
 *
 * FK to `connections` is emitted by the migration (ON DELETE CASCADE),
 * mirroring `FulfillmentRoutingRuleOrmEntity`'s convention.
 *
 * @module libs/core/src/sales-documents/infrastructure/persistence/entities
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('sales_document_rules')
@Index('UQ_sales_document_rules_country_hash_from', ['country', 'conditionsHash', 'effectiveFrom'], {
  unique: true,
})
// Non-unique — the FK join target. Now mirrored here (review, optional
// improvements: the migration created it without a matching entity
// declaration). No separate `(country, conditionsHash)` index exists —
// those columns are already the leading prefix of the unique index above,
// which Postgres can serve a `(country, conditionsHash)`-only lookup from
// directly, so a second index would be pure write overhead.
@Index('IDX_sales_document_rules_connection_id', ['connectionId'])
export class SalesDocumentRuleOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 8, name: 'country' })
  country!: string;

  @Column({ type: 'jsonb', name: 'conditions' })
  conditions!: unknown;

  @Column({ type: 'varchar', length: 64, name: 'conditions_hash' })
  conditionsHash!: string;

  @Column({ type: 'varchar', length: 64, name: 'document_kind' })
  documentKind!: string;

  @Column({ type: 'uuid', name: 'connection_id' })
  connectionId!: string;

  @Column({ type: 'date', name: 'effective_from' })
  effectiveFrom!: string;

  @Column({ type: 'date', name: 'effective_to', nullable: true })
  effectiveTo!: string | null;

  @Column({ type: 'varchar', length: 255, name: 'provenance', nullable: true })
  provenance!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
