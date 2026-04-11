/**
 * Status Mapping ORM Entity
 *
 * TypeORM entity for the connection_status_mappings table.
 * Maps Allegro order statuses to PrestaShop order status IDs per connection.
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

@Entity('connection_status_mappings')
@Index(['connectionId', 'allegroStatus'], { unique: true })
export class StatusMappingOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'connection_id' })
  connectionId!: string;

  @Column({ type: 'varchar', length: 100, name: 'allegro_status' })
  allegroStatus!: string;

  @Column({ type: 'varchar', length: 20, name: 'prestashop_status_id' })
  prestashopStatusId!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
