/**
 * Operational Settings ORM Entity
 *
 * TypeORM mapping for the `operational_settings` singleton-row table (#2651).
 * `id` is always `'singleton'`. Every value column is NULLABLE, and that is the
 * contract rather than a convenience: `NULL` means "not set", which is what
 * lets the service fall through to the env var and then to the code default,
 * and what keeps an untouched install byte-identical.
 *
 * @module libs/core/src/operational-settings/infrastructure/persistence/entities
 */
import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('operational_settings')
export class OperationalSettingsOrmEntity {
  @PrimaryColumn({ type: 'text', name: 'id' })
  id!: string;

  @Column({ type: 'integer', name: 'catalogue_sweep_budget', nullable: true })
  catalogueSweepBudget!: number | null;

  @Column({ type: 'integer', name: 'inventory_sweep_budget', nullable: true })
  inventorySweepBudget!: number | null;

  @Column({ type: 'integer', name: 'sweep_page_size', nullable: true })
  sweepPageSize!: number | null;

  @Column({ type: 'integer', name: 'deletion_audit_budget', nullable: true })
  deletionAuditBudget!: number | null;

  @Column({ type: 'text', name: 'deletion_audit_cadence', nullable: true })
  deletionAuditCadence!: string | null;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @Column({ type: 'text', name: 'updated_by', nullable: true })
  updatedBy!: string | null;
}
