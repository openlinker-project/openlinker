/**
 * Analytics Remediation Run ORM Entity
 *
 * TypeORM mapping for the `analytics_remediation_runs` audit ledger (#2468).
 * Column naming follows the sibling `analytics_display_settings` /
 * `posthog_settings` tables in this same context (explicit snake_case names,
 * `timestamptz` audit columns).
 *
 * THE PARTIAL UNIQUE INDEX IS DECLARED IN BOTH PLACES, and deliberately so.
 * The hand-authored migration is authoritative for a real deployment, but the
 * integration harness builds its schema from these entities — so an
 * entity-only-absent index means the "at most one open run per category" guard
 * silently does not exist under test, which is precisely where it needs to be
 * provable. The two definitions share one index name so they describe the same
 * object rather than two.
 *
 * @module libs/core/src/analytics/infrastructure/persistence/entities
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('analytics_remediation_runs')
@Index('IDX_analytics_remediation_runs_category_created', ['category', 'createdAt'])
@Index('UQ_analytics_remediation_runs_open_per_category', ['category'], {
  unique: true,
  where: `"status" IN ('open', 'in-progress')`,
})
export class AnalyticsRemediationRunOrmEntity {
  @PrimaryColumn({ type: 'text', name: 'id' })
  id!: string;

  @Column({ type: 'text', name: 'category' })
  category!: string;

  @Column({ type: 'text', name: 'status' })
  status!: string;

  @Column({ type: 'text', name: 'detail', nullable: true })
  detail!: string | null;

  @Column({ type: 'integer', name: 'affected_count' })
  affectedCount!: number;

  @Column({ type: 'text', name: 'triggered_by' })
  triggeredByUserId!: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
