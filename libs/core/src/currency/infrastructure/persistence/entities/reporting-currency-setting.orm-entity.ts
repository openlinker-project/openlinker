/**
 * Reporting Currency Setting ORM Entity
 *
 * TypeORM mapping for the `reporting_currency_setting` singleton-row table.
 * The `id` column is always `'singleton'`; the row is upserted by
 * `ReportingCurrencySettingRepository.upsertSetting`.
 *
 * snake_case column names with explicit `name:`, matching the three existing
 * singleton settings tables (`ai_provider_active_setting`, `mailer_settings`,
 * `posthog_settings`). That differs from `exchange_rates`' quoted camelCase in
 * the same context, deliberately: each table follows the convention of the
 * family it belongs to rather than unifying across two unrelated shapes.
 *
 * @module libs/core/src/currency/infrastructure/persistence/entities
 */
import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('reporting_currency_setting')
export class ReportingCurrencySettingOrmEntity {
  @PrimaryColumn({ type: 'text', name: 'id' })
  id!: string;

  @Column({ type: 'varchar', length: 3, name: 'reporting_currency' })
  reportingCurrency!: string;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @Column({ type: 'text', name: 'updated_by', nullable: true })
  updatedBy!: string | null;
}
