/**
 * AI Provider Active Setting ORM Entity
 *
 * TypeORM mapping for the `ai_provider_active_setting` singleton-row table.
 * The `id` column is always `'singleton'` (literal); the row is upserted by
 * `AiProviderActiveSettingRepository.upsertActive`. Production gets the
 * schema via the DDL migration; integration-test harness materialises it
 * via `synchronize: true`.
 *
 * @module libs/core/src/ai/infrastructure/persistence/entities
 */
import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('ai_provider_active_setting')
export class AiProviderActiveSettingOrmEntity {
  @PrimaryColumn({ type: 'text', name: 'id' })
  id!: string;

  @Column({ type: 'text', name: 'active_provider' })
  activeProvider!: string;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @Column({ type: 'text', name: 'updated_by', nullable: true })
  updatedBy!: string | null;
}
