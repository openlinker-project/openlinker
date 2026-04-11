/**
 * Payment Mapping ORM Entity
 *
 * TypeORM entity for the connection_payment_mappings table.
 * Maps Allegro payment provider names to PrestaShop payment module names per connection.
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

@Entity('connection_payment_mappings')
@Index(['connectionId', 'allegroPaymentProvider'], { unique: true })
export class PaymentMappingOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'connection_id' })
  connectionId!: string;

  @Column({ type: 'varchar', length: 100, name: 'allegro_payment_provider' })
  allegroPaymentProvider!: string;

  @Column({ type: 'varchar', length: 100, name: 'prestashop_payment_module' })
  prestashopPaymentModule!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
