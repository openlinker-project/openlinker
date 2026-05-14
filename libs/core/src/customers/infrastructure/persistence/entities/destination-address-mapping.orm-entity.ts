/**
 * Destination Address Mapping ORM Entity
 *
 * TypeORM entity representing the destination_address_mappings table in PostgreSQL.
 * Stores mappings between internal customer addresses (identified by addressHash)
 * and destination-specific address IDs (e.g., PrestaShop address ID).
 *
 * Enables address reuse across orders without adding Address to IdentifierMapping.
 * Composite unique constraint ensures one mapping per (customer, connection, hash, type).
 *
 * @module libs/core/src/customers/infrastructure/persistence/entities
 */
import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('destination_address_mappings')
@Index(['internalCustomerId', 'destinationConnectionId'])
@Index(['destinationConnectionId', 'addressHash', 'addressType'])
export class DestinationAddressMappingOrmEntity {
  @PrimaryColumn({ type: 'text' })
  internalCustomerId!: string;

  @PrimaryColumn({ type: 'uuid' })
  destinationConnectionId!: string;

  @PrimaryColumn({ type: 'varchar', length: 64 })
  addressHash!: string;

  @PrimaryColumn({ type: 'varchar', length: 20 })
  addressType!: string; // 'shipping' | 'billing'

  @Column({ type: 'varchar' })
  destinationAddressId!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
