/**
 * Webhook Delivery ORM Entity
 *
 * TypeORM entity for the webhook_deliveries table. Records the lifecycle of
 * each inbound webhook from receipt through publishing and downstream job
 * linkage. Used by the visibility API.
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

@Entity('webhook_deliveries')
@Unique('uq_webhook_deliveries_event_key', ['provider', 'connectionId', 'eventId'])
@Index(['receivedAt'])
@Index(['connectionId', 'receivedAt'])
@Index(['provider', 'receivedAt'])
@Index(['status', 'receivedAt'])
export class WebhookDeliveryOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text' })
  eventId!: string;

  @Column({ type: 'text' })
  provider!: string;

  @Column({ type: 'uuid' })
  connectionId!: string;

  @Column({ type: 'text', nullable: true })
  eventType!: string | null;

  @Column({ type: 'text', nullable: true })
  objectType!: string | null;

  @Column({ type: 'text', nullable: true })
  externalId!: string | null;

  @Column({ type: 'timestamptz' })
  receivedAt!: Date;

  @Column({ type: 'boolean', nullable: true })
  signatureValid!: boolean | null;

  @Column({ type: 'text', nullable: true })
  dedupResult!: string | null;

  @Column({ type: 'text' })
  status!: string;

  @Column({ type: 'text', nullable: true })
  rejectionReason!: string | null;

  @Column({ type: 'text', nullable: true })
  publishedMessageId!: string | null;

  @Column({ type: 'text', nullable: true })
  downstreamJobId!: string | null;

  @Column({ type: 'text', nullable: true })
  downstreamJobType!: string | null;

  @Column({ type: 'text', nullable: true })
  dlqReason!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  payload!: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
