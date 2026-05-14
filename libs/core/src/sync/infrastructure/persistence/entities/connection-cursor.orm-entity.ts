/**
 * Connection Cursor ORM Entity
 *
 * TypeORM entity representing the connection_cursors table in PostgreSQL.
 * Stores cursor values (e.g., lastEventId) per connection for incremental
 * sync state tracking. Used by polling jobs to resume from the last processed
 * position.
 *
 * @module libs/core/src/sync/infrastructure/persistence/entities
 */
import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('connection_cursors')
@Index(['connectionId', 'cursorKey'], { unique: true })
export class ConnectionCursorOrmEntity {
  @PrimaryColumn('uuid')
  connectionId!: string;

  @PrimaryColumn({ type: 'varchar' })
  cursorKey!: string;

  @Column({ type: 'text' })
  value!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
