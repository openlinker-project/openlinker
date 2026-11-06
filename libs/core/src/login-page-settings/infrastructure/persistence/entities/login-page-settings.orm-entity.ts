/**
 * Login Page Settings ORM Entity
 *
 * TypeORM mapping for the `login_page_settings` singleton row (#4028).
 *
 * @module libs/core/src/login-page-settings/infrastructure/persistence/entities
 */
import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('login_page_settings')
export class LoginPageSettingsOrmEntity {
  @PrimaryColumn({ type: 'text', name: 'id' })
  id!: string;

  @Column({ type: 'jsonb', name: 'copy', default: () => "'{}'" })
  copy!: unknown;

  @Column({ type: 'boolean', name: 'registration_enabled', nullable: true })
  registrationEnabled!: boolean | null;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @Column({ type: 'text', name: 'updated_by', nullable: true })
  updatedBy!: string | null;
}
