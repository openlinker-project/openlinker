/**
 * PostHog Settings ORM Entity
 *
 * TypeORM mapping for the `posthog_settings` singleton-row table. The `id`
 * column is always `'singleton'` (literal); the row is upserted by
 * `PosthogSettingsRepository.upsertSettings`. Production gets the schema via
 * the DDL migration; integration-test harness materialises it via
 * `synchronize: true`.
 *
 * @module libs/core/src/analytics/infrastructure/persistence/entities
 */
import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('posthog_settings')
export class PosthogSettingsOrmEntity {
  @PrimaryColumn({ type: 'text', name: 'id' })
  id!: string;

  @Column({ type: 'boolean', name: 'enabled', default: false })
  enabled!: boolean;

  @Column({ type: 'text', name: 'region' })
  region!: string;

  @Column({ type: 'text', name: 'custom_host', nullable: true })
  customHost!: string | null;

  @Column({ type: 'boolean', name: 'autocapture', default: false })
  autocapture!: boolean;

  @Column({ type: 'boolean', name: 'session_recording', default: false })
  sessionRecording!: boolean;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @Column({ type: 'text', name: 'updated_by', nullable: true })
  updatedBy!: string | null;
}
