/**
 * Allegro Quantity Command ORM Entity
 *
 * TypeORM entity representing the allegro_quantity_commands table in PostgreSQL.
 * Stores Allegro offer quantity change command status for observability and debugging.
 *
 * @module libs/integrations/allegro/src/infrastructure/persistence/entities
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Command status values
 */
export const AllegroQuantityCommandStatusValues = [
  'queued',
  'accepted',
  'rejected',
  'failed',
] as const;

export type AllegroQuantityCommandStatus = (typeof AllegroQuantityCommandStatusValues)[number];

@Entity('allegro_quantity_commands')
@Index(['commandId'], { unique: true })
@Index(['connectionId', 'createdAt'])
@Index(['status', 'createdAt'])
export class AllegroQuantityCommandOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar' })
  commandId!: string;

  @Column('uuid')
  connectionId!: string;

  @Column({ type: 'varchar' })
  offerId!: string;

  @Column({ type: 'integer' })
  quantity!: number;

  @Column({ type: 'varchar' })
  status!: AllegroQuantityCommandStatus;

  @Column({ type: 'text', nullable: true })
  error!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}



