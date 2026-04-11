/**
 * Carrier Mapping ORM Entity
 *
 * TypeORM entity for the connection_carrier_mappings table.
 * Maps Allegro delivery method IDs to PrestaShop carrier IDs per connection.
 *
 * @module libs/core/src/mappings/infrastructure/persistence/entities
 */

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('connection_carrier_mappings')
@Index(['connectionId', 'allegroDeliveryMethodId'], { unique: true })
export class CarrierMappingOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'connection_id' })
  connectionId!: string;

  @Column({ type: 'varchar', name: 'allegro_delivery_method_id' })
  allegroDeliveryMethodId!: string;

  @Column({ type: 'varchar', name: 'prestashop_carrier_id' })
  prestashopCarrierId!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
