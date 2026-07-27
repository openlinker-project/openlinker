/**
 * Mailer Settings ORM Entity
 *
 * TypeORM mapping for the `mailer_settings` singleton-row table. The `id`
 * column is always `'singleton'` (literal); the row is upserted by
 * `MailerSettingsRepository.upsertSettings`. Production gets the schema via
 * the DDL migration; integration-test harness materialises it via
 * `synchronize: true`.
 *
 * @module libs/core/src/mailer/infrastructure/persistence/entities
 */
import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('mailer_settings')
export class MailerSettingsOrmEntity {
  @PrimaryColumn({ type: 'text', name: 'id' })
  id!: string;

  @Column({ type: 'text', name: 'transport' })
  transport!: string;

  @Column({ type: 'text', name: 'smtp_host', nullable: true })
  smtpHost!: string | null;

  @Column({ type: 'integer', name: 'smtp_port', nullable: true })
  smtpPort!: number | null;

  @Column({ type: 'boolean', name: 'smtp_secure', default: false })
  smtpSecure!: boolean;

  @Column({ type: 'text', name: 'from_address', nullable: true })
  fromAddress!: string | null;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @Column({ type: 'text', name: 'updated_by', nullable: true })
  updatedBy!: string | null;
}
