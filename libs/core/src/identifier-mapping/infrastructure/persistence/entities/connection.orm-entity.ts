/**
 * Connection ORM Entity
 *
 * TypeORM entity representing the connections table in PostgreSQL.
 * Stores configured integration instances (e.g., specific PrestaShop stores,
 * specific Allegro accounts). Includes indexes for efficient lookups by
 * platform type, status, and adapter key.
 *
 * @module libs/core/src/identifier-mapping/infrastructure/persistence/entities
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('connections')
@Index(['platformType'])
@Index(['status'])
@Index(['adapterKey'])
export class ConnectionOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  platformType!: string;

  @Column()
  name!: string;

  @Column()
  status!: string;

  @Column({ type: 'jsonb' })
  config!: Record<string, unknown>;

  @Column()
  credentialsRef!: string;

  @Column({ nullable: true })
  adapterKey?: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}



