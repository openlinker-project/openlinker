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

  /** Days a `succeeded` sync_jobs row is kept before the retention prune deletes it (#2946, D16). */
  @Column({ type: 'integer', name: 'sync_job_retention_days', nullable: true })
  syncJobRetentionDays!: number | null;

  /** Days a `dead` sync_jobs row is kept (#2946, D16). */
  @Column({ type: 'integer', name: 'sync_job_dead_retention_days', nullable: true })
  syncJobDeadRetentionDays!: number | null;

  /** Days an `inventory_movements` ledger row is kept before the retention prune deletes it (#3565). */
  @Column({ type: 'integer', name: 'inventory_movement_retention_days', nullable: true })
  inventoryMovementRetentionDays!: number | null;

  /** Hours a stock observation may age before the stock view flags it stale (#3621). */
  @Column({ type: 'integer', name: 'stock_stale_sync_threshold_hours', nullable: true })
  stockStaleSyncThresholdHours!: number | null;

  /** Release center on/off (#4141); NULL falls through to env and default. */
  @Column({ type: 'boolean', name: 'release_center_enabled', nullable: true })
  releaseCenterEnabled!: boolean | null;

  @Column({ type: 'text', name: 'deletion_audit_cadence', nullable: true })
  deletionAuditCadence!: string | null;

  /** Buyer data retention master switch (#4289). `NULL` = not set (off). */
  @Column({ type: 'boolean', name: 'buyer_data_retention_enabled', nullable: true })
  buyerDataRetentionEnabled!: boolean | null;

  /** Days until an order is hidden (#4289). `0` = never, `NULL` = not set. */
  @Column({ type: 'integer', name: 'buyer_data_hide_after_days', nullable: true })
  buyerDataHideAfterDays!: number | null;

  /** Days until buyer personal data is erased (#4289). `0` = never, `NULL` = not set. */
  @Column({ type: 'integer', name: 'buyer_data_erase_after_days', nullable: true })
  buyerDataEraseAfterDays!: number | null;

  /** `personal-data` | `whole-order` (#4289). Coerced on read. */
  @Column({ type: 'text', name: 'buyer_data_erase_mode', nullable: true })
  buyerDataEraseMode!: string | null;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @Column({ type: 'text', name: 'updated_by', nullable: true })
  updatedBy!: string | null;
}
