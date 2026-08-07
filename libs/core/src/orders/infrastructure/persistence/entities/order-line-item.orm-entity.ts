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
  @Index()
  productId!: string;

  @Column({ type: 'text', nullable: true })
  @Index()
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
  @Index()
  sourceConnectionId!: string;

  /** Denormalized from the parent order (#1985) so a date-range query never joins back. */
  @Column({ type: 'timestamptz', nullable: true })
  @Index()
  placedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}
