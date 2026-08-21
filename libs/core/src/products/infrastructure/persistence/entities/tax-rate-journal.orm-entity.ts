/**
 * Tax-Rate Journal ORM Entity (#2250)
 *
 * TypeORM entity for the `tax_rate_journal` table - one row per CHANGE in an
 * observed tax rate, never one per read.
 *
 * @module libs/core/src/products/infrastructure/persistence/entities
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('tax_rate_journal')
// "The latest entry for this item on this connection" is the read every
// consumer makes, so it is one indexed lookup rather than a scan.
@Index('IDX_tax_rate_journal_latest', ['productId', 'variantId', 'connectionId', 'observedAt'])
export class TaxRateJournalOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  productId!: string;

  /** Null when the observation is about the product rather than one variant. */
  @Column({ type: 'text', nullable: true })
  variantId!: string | null;

  @Column({ type: 'uuid' })
  connectionId!: string;

  /** `shop` | `channel` | `written-by-us`. Kept as varchar: the union is core's. */
  @Column({ type: 'varchar', length: 32 })
  origin!: string;

  /** The observed code, or null when the source named no rate. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  taxRate!: string | null;

  /**
   * The channel reported the field as frozen by the seller. Defaults false so
   * a shop observation - which has no such concept - reads as not-frozen
   * rather than as unknown.
   */
  @Column({ type: 'boolean', default: false })
  frozen!: boolean;

  /**
   * When the observation was made, as distinct from when the row was written.
   * `timestamptz` so the value is stored without a silent tz coercion.
   */
  @Column({ type: 'timestamptz' })
  observedAt!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
