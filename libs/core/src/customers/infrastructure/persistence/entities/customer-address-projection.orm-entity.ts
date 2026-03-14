/**
 * Customer Address Projection ORM Entity
 *
 * TypeORM entity representing the customer_address_projections table in PostgreSQL.
 * Stores address history projections for customers. Multiple addresses can exist
 * for the same customer (composite primary key). addressHash is always stored;
 * PII fields are optional based on OL_STORE_PII configuration.
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

@Entity('customer_address_projections')
@Index(['internalCustomerId'])
export class CustomerAddressProjectionOrmEntity {
  @PrimaryColumn({ type: 'text' })
  internalCustomerId!: string;

  @PrimaryColumn({ type: 'varchar', length: 64 })
  addressHash!: string;

  @PrimaryColumn({ type: 'varchar', length: 20 })
  addressType!: string; // 'shipping' | 'billing'

  @Column({ type: 'varchar', nullable: true })
  address1!: string | null;

  @Column({ type: 'varchar', nullable: true })
  address2!: string | null;

  @Column({ type: 'varchar', nullable: true })
  city!: string | null;

  @Column({ type: 'varchar', nullable: true })
  postcode!: string | null;

  @Column({ type: 'varchar', length: 2, nullable: true })
  countryIso2!: string | null;

  @Column({ type: 'timestamp' })
  lastSeenAt!: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
