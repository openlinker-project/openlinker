/**
 * Refund Record ORM Entity
 *
 * TypeORM-decorated persistence shape for `refund_records` (#2036). Mirrors
 * `InvoiceRecordOrmEntity`'s shape: a plain UUID PK, and a plain indexed
 * `text` column referencing `order_records.internalOrderId` by value only —
 * no FK constraint (avoids cross-table lock coupling; existence is verified
 * at the application layer instead).
 *
 * @module infrastructure/persistence/entities
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('refund_records')
export class RefundRecordOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'text' })
  internalOrderId!: string;

  @Column({ type: 'text' })
  amount!: string;

  @Column({ type: 'varchar', length: 3 })
  currency!: string;

  @Column({ type: 'text' })
  reason!: string;

  @Column({ type: 'text', nullable: true })
  note: string | null = null;

  @Column({ type: 'timestamptz' })
  recordedAt!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
