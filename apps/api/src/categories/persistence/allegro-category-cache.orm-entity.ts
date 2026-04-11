/**
 * Allegro Category Cache ORM Entity
 *
 * TypeORM entity for the allegro_category_cache table.
 * Stores fetched Allegro categories per connection for fast retrieval
 * without repeated API calls. Entries are considered stale after 24 hours.
 *
 * @module apps/api/src/categories/persistence
 */

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
} from 'typeorm';

@Entity('allegro_category_cache')
@Index(['connectionId', 'allegroCategoryId'], { unique: true })
@Index(['connectionId', 'parentId'])
export class AllegroCategoryCacheOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'connection_id' })
  connectionId!: string;

  @Column({ type: 'varchar', length: 100, name: 'allegro_category_id' })
  allegroCategoryId!: string;

  @Column({ type: 'varchar', length: 500 })
  name!: string;

  @Column({ type: 'varchar', length: 100, name: 'parent_id', nullable: true })
  parentId!: string | null;

  @Column({ type: 'boolean', default: false })
  leaf!: boolean;

  @Column({ type: 'timestamptz', name: 'fetched_at', default: () => 'now()' })
  fetchedAt!: Date;
}
