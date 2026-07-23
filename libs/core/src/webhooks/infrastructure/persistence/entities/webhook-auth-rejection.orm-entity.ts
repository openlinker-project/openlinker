/**
 * Webhook Auth Rejection ORM Entity
 *
 * TypeORM entity for the `webhook_auth_rejections` table — one rolling row per
 * `(provider, connectionId)` capturing signature-rejected inbound deliveries
 * that never reach `webhook_deliveries` (ADR-005). Backs the `auth-failing`
 * webhook status (#1814).
 *
 * @module libs/core/src/webhooks/infrastructure/persistence/entities
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

@Entity('webhook_auth_rejections')
@Unique('uq_webhook_auth_rejections_key', ['provider', 'connectionId'])
@Index(['connectionId'])
export class WebhookAuthRejectionOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  provider!: string;

  @Column({ type: 'uuid' })
  connectionId!: string;

  @Column({ type: 'bigint' })
  rejectionCount!: string;

  @Column({ type: 'timestamptz' })
  firstRejectedAt!: Date;

  @Column({ type: 'timestamptz' })
  lastRejectedAt!: Date;

  @Column({ type: 'text', nullable: true })
  lastReason!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
