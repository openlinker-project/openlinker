/**
 * Buyer Email Delivery ORM Entity (#3554)
 *
 * No foreign keys (`internalOrderId` / `connectionId` are references by value,
 * the `document_email_deliveries` precedent) and no PG enum or CHECK on a
 * vocabulary column: the integration harness builds schema by `synchronize`.
 *
 * @module libs/core/src/orders/infrastructure/persistence/entities
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('buyer_email_deliveries')
@Index('IDX_buyer_email_deliveries_order_created', ['internalOrderId', 'createdAt'])
export class BuyerEmailDeliveryOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'text', name: 'internalOrderId' })
  internalOrderId!: string;

  @Column({ type: 'text', name: 'connectionId' })
  connectionId!: string;

  @Column({ type: 'varchar', length: 64, name: 'templateKey' })
  templateKey!: string;

  @Column({ type: 'text', name: 'subjectRef' })
  subjectRef!: string;

  @Column({ type: 'varchar', length: 16, name: 'outcome' })
  outcome!: string;

  @Column({ type: 'varchar', length: 64, name: 'suppressionReason', nullable: true })
  suppressionReason!: string | null;

  @Column({ type: 'text', name: 'recipient', nullable: true })
  recipient!: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'createdAt' })
  createdAt!: Date;
}
