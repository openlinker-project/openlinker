/**
 * Category Mapping ORM Entity
 *
 * TypeORM entity for the category_mappings table.
 * Maps PrestaShop categories to Allegro categories per connection.
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

@Entity('category_mappings')
@Index(['connectionId', 'prestashopCategoryId'], { unique: true })
export class CategoryMappingOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'connection_id' })
  connectionId!: string;

  @Column({ type: 'varchar', length: 100, name: 'prestashop_category_id' })
  prestashopCategoryId!: string;

  @Column({ type: 'varchar', length: 100, name: 'allegro_category_id' })
  allegroCategoryId!: string;

  @Column({ type: 'varchar', length: 500, name: 'allegro_category_name' })
  allegroCategoryName!: string;

  @Column({ type: 'varchar', length: 1000, name: 'allegro_category_path', nullable: true })
  allegroCategoryPath!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
