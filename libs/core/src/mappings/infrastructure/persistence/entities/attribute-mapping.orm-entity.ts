/**
 * Attribute Mapping ORM Entity
 *
 * TypeORM entity for the `attribute_mappings` table (#1038, ADR-023 §4). Maps a
 * source attribute key to a destination parameter name, scoped by source +
 * destination connection with an optional per-category override.
 *
 * Uniqueness is two partial unique indexes (NULL-distinct on the nullable
 * `destination_category_id`) declared here AND created by the migration — the
 * decorators keep synchronize-built schemas (integration tests) in parity with
 * the migration-built production schema; index names match the migration.
 *
 * @module libs/core/src/mappings/infrastructure/persistence/entities
 */

import {
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AttributeValueMappingOrmEntity } from './attribute-value-mapping.orm-entity';

@Entity('attribute_mappings')
@Index('IX_attribute_mappings_destination', ['destinationConnectionId'])
@Index(
  'UQ_attribute_mappings_default',
  ['sourceConnectionId', 'destinationConnectionId', 'sourceAttributeKey'],
  { unique: true, where: '"destination_category_id" IS NULL' }
)
@Index(
  'UQ_attribute_mappings_per_category',
  ['sourceConnectionId', 'destinationConnectionId', 'sourceAttributeKey', 'destinationCategoryId'],
  { unique: true, where: '"destination_category_id" IS NOT NULL' }
)
export class AttributeMappingOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'source_connection_id' })
  sourceConnectionId!: string;

  @Column({ type: 'uuid', name: 'destination_connection_id' })
  destinationConnectionId!: string;

  @Column({ type: 'varchar', length: 255, name: 'source_attribute_key' })
  sourceAttributeKey!: string;

  @Column({ type: 'varchar', length: 255, name: 'destination_parameter_name' })
  destinationParameterName!: string;

  @Column({ type: 'varchar', length: 100, name: 'destination_category_id', nullable: true })
  destinationCategoryId!: string | null;

  // Owner-taxonomy provenance (#1045) — the owner whose parameter names this row
  // is authored against (e.g. 'allegro'). A `borrows` destination (ERLI) reuses
  // these rows by provenance. Default keeps existing rows resolvable post-migration.
  @Column({
    type: 'varchar',
    length: 50,
    name: 'destination_taxonomy_provenance',
    default: 'allegro',
  })
  destinationTaxonomyProvenance!: string;

  // Cascade + orphan-delete: setting `values` and saving the parent
  // inserts/updates/removes the child set atomically (no manual transaction).
  // Eager so reads return the full aggregate.
  @OneToMany(() => AttributeValueMappingOrmEntity, (v) => v.attributeMapping, {
    cascade: true,
    orphanedRowAction: 'delete',
    eager: true,
  })
  values!: AttributeValueMappingOrmEntity[];

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
