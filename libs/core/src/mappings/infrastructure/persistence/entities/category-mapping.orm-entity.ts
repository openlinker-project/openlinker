/**
 * Category Mapping ORM Entity
 *
 * TypeORM entity for the category_mappings table. Maps a source category to a
 * destination category per destination connection (#1036, ADR-023 §2).
 *
 * Uniqueness is two partial unique indexes (NULL-distinct on the nullable
 * `source_connection_id`) declared here AND created by the migration — the
 * decorators keep synchronize-built schemas (integration tests) in parity with
 * the migration-built production schema; index names match the migration.
 *
 * @module libs/core/src/mappings/infrastructure/persistence/entities
 */

import {
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('category_mappings')
@Index(
  'UQ_category_mappings_src_dest_cat',
  ['sourceConnectionId', 'destinationConnectionId', 'sourceCategoryId'],
  { unique: true, where: '"source_connection_id" IS NOT NULL' }
)
@Index(
  'UQ_category_mappings_dest_cat_nullsrc',
  ['destinationConnectionId', 'sourceCategoryId'],
  { unique: true, where: '"source_connection_id" IS NULL' }
)
export class CategoryMappingOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'source_connection_id', nullable: true })
  sourceConnectionId!: string | null;

  @Column({ type: 'uuid', name: 'destination_connection_id' })
  destinationConnectionId!: string;

  @Column({ type: 'varchar', length: 100, name: 'source_category_id' })
  sourceCategoryId!: string;

  @Column({ type: 'varchar', length: 100, name: 'destination_category_id' })
  destinationCategoryId!: string;

  @Column({ type: 'varchar', length: 500, name: 'destination_category_name' })
  destinationCategoryName!: string;

  @Column({ type: 'varchar', length: 1000, name: 'destination_category_path', nullable: true })
  destinationCategoryPath!: string | null;

  @Column({ type: 'varchar', length: 50, name: 'destination_taxonomy_provenance', default: 'allegro' })
  destinationTaxonomyProvenance!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
