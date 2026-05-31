/**
 * Order State Mapping ORM Entity
 *
 * TypeORM entity for the connection_order_state_mappings table (#862).
 * Maps a canonical OL OrderStatus to the destination platform's native
 * order-state id, scoped per destination connection. The `external_state_id`
 * column is platform-neutral by design (PrestaShop stores its numeric
 * order-state id as a string).
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

@Entity('connection_order_state_mappings')
@Index(['connectionId', 'olStatus'], { unique: true })
export class OrderStateMappingOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'connection_id' })
  connectionId!: string;

  @Column({ type: 'varchar', length: 50, name: 'ol_status' })
  olStatus!: string;

  @Column({ type: 'varchar', length: 50, name: 'external_state_id' })
  externalStateId!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
