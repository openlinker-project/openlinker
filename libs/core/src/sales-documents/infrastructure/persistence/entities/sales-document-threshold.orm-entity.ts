/**
 * Sales-Document Threshold ORM Entity (#2170, ADR-041 decision 5 — "regime pack")
 *
 * `ref` is the primary key (a mono string) rather than a generated id — rules
 * reference it directly via `thresholdRef`.
 *
 * @module libs/core/src/sales-documents/infrastructure/persistence/entities
 */
import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('sales_document_thresholds')
export class SalesDocumentThresholdOrmEntity {
  @PrimaryColumn({ type: 'varchar', length: 128, name: 'ref' })
  ref!: string;

  @Column({ type: 'numeric', precision: 18, scale: 2, name: 'amount' })
  amount!: string;

  @Column({ type: 'varchar', length: 3, name: 'currency' })
  currency!: string;

  @Column({ type: 'varchar', length: 8, name: 'comparison_op' })
  comparisonOp!: string;

  @Column({ type: 'date', name: 'version_effective_from' })
  versionEffectiveFrom!: string;

  @Column({ type: 'date', name: 'version_effective_to', nullable: true })
  versionEffectiveTo!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
