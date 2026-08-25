/**
 * Analytics Display Settings ORM Entity
 *
 * TypeORM mapping for the `analytics_display_settings` singleton-row table.
 * The `id` column is always `'singleton'` (literal); the row is upserted by
 * `AnalyticsDisplaySettingsRepository.upsertSettings`. Column naming mirrors
 * the sibling `posthog_settings` table in this same context.
 *
 * @module libs/core/src/analytics/infrastructure/persistence/entities
 */
import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('analytics_display_settings')
export class AnalyticsDisplaySettingsOrmEntity {
  @PrimaryColumn({ type: 'text', name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 3, name: 'display_currency', nullable: true })
  displayCurrency!: string | null;

  @Column({ type: 'text', name: 'rate_basis', default: 'current' })
  rateBasis!: string;

  @Column({
    type: 'boolean',
    name: 'include_backfilled_tax_rates_in_net_sales',
    default: false,
  })
  includeBackfilledTaxRatesInNetSales!: boolean;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @Column({ type: 'text', name: 'updated_by_user_id', nullable: true })
  updatedByUserId!: string | null;
}
