/**
 * Customer Projection ORM Entity
 *
 * TypeORM entity representing the customer_projections table in PostgreSQL.
 * Stores lightweight customer projections (Model C) for debugging, retry support,
 * and future routing. emailHash is always stored; PII fields are optional based
 * on OL_STORE_PII configuration.
 *
 * @module libs/core/src/customers/infrastructure/persistence/entities
 */
import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('customer_projections')
@Index(['emailHash'])
export class CustomerProjectionOrmEntity {
  @PrimaryColumn({ type: 'text' })
  internalCustomerId!: string;

  @Column({ type: 'varchar', length: 64 })
  emailHash!: string;

  @Column({ type: 'varchar', nullable: true })
  normalizedEmail!: string | null;

  @Column({ type: 'varchar', nullable: true })
  firstName!: string | null;

  @Column({ type: 'varchar', nullable: true })
  lastName!: string | null;

  @Column({ type: 'timestamp' })
  lastSeenAt!: Date;

  @Column({ type: 'uuid', nullable: true })
  lastSourceConnectionId!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
