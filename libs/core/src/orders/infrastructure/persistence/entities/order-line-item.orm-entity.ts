/**
 * Order Line Item ORM Entity
 *
 * TypeORM entity representing the `order_line_items` table (#1985) — one
 * queryable row per order line, the analytics-read-model counterpart to the
 * JSONB `order_records.orderSnapshot.items` array. See ADR-039 for the
 * persistence-strategy decision.
 *
 * @module libs/core/src/orders/infrastructure/persistence/entities
 */
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, Unique } from 'typeorm';

@Entity('order_line_items')
@Unique(['orderRecordId', 'lineNumber'])
// Composite, matching the #1987/#1988 access patterns rather than one
// single-column index per column (review finding: five single-column
// indexes on a table written on every order ingest is real write
// amplification, and none of them served the actual queries well). See the
// 1837000000000 migration's comment for the per-index query it backs.
// variantId and a standalone placedAt index are deferred until a query
// actually needs them.
@Index(['sourceConnectionId', 'placedAt'])
@Index(['productId', 'placedAt'])
export class OrderLineItemOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** References `order_records.internalOrderId` by convention — no DB-enforced FK (internal ids are TEXT, matching the rest of the schema). */
  @Column({ type: 'text' })
  @Index()
  orderRecordId!: string;

  /**
   * Position within the order's `items[]` array at persist time. Paired with
   * `orderRecordId` in the unique constraint above — the conflict target the
   * idempotent delete-then-reinsert write path relies on.
   */
  @Column({ type: 'int' })
  lineNumber!: number;

  @Column({ type: 'text' })
  productId!: string;

  @Column({ type: 'text', nullable: true })
  variantId!: string | null;

  @Column({ type: 'int' })
  quantity!: number;

  // decimal (not numeric) — matches the house convention on money columns
  // (products.price, product_variants.price); pg returns this as a string at
  // the driver level, converted back to number in the repository's toDomain.
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  unitPrice!: number;

  /** Denormalized from the parent order (#1985) so a channel-split query never joins back. */
  @Column({ type: 'uuid' })
  sourceConnectionId!: string;

  /** Denormalized from the parent order (#1985) so a date-range query never joins back. */
  @Column({ type: 'timestamptz', nullable: true })
  placedAt!: Date | null;

  /**
   * The settled per-line tax rate, transcribed from the snapshot (#2250).
   *
   * The snapshot is where a rate is DECIDED; this column is the queryable copy,
   * so an analytics read never expands JSON to group revenue by rate. A single
   * writer, the same `upsertWithLineItems` that writes every other column here.
   */
  @Column({ type: 'varchar', length: 16, nullable: true })
  taxRate!: string | null;

  /**
   * Which system stated it. Carried rather than derived, because *no rate*,
   * *never read* and *pre-rollout* are three different facts and one null rate
   * cannot separate them (#2245 F3).
   */
  @Column({ type: 'varchar', length: 16, nullable: true })
  taxSource!: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  taxRateReadAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}
