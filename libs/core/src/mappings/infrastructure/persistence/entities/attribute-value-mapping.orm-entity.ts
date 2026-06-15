/**
 * Attribute Value Mapping ORM Entity
 *
 * TypeORM entity for the `attribute_value_mappings` table (#1038, ADR-023 §4).
 * A child of `attribute_mappings` carrying one source-value → destination-value
 * translation. FK cascades on parent delete; unique per `(attribute_mapping_id,
 * source_value)`.
 *
 * @module libs/core/src/mappings/infrastructure/persistence/entities
 */

import {
  Entity,
  Index,
  ManyToOne,
  JoinColumn,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { AttributeMappingOrmEntity } from './attribute-mapping.orm-entity';

@Entity('attribute_value_mappings')
@Index('UQ_attribute_value_mappings_mapping_source', ['attributeMappingId', 'sourceValue'], {
  unique: true,
})
export class AttributeValueMappingOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'attribute_mapping_id' })
  attributeMappingId!: string;

  @ManyToOne(() => AttributeMappingOrmEntity, (m) => m.values, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'attribute_mapping_id' })
  attributeMapping!: AttributeMappingOrmEntity;

  @Column({ type: 'varchar', length: 255, name: 'source_value' })
  sourceValue!: string;

  @Column({ type: 'varchar', length: 255, name: 'destination_value' })
  destinationValue!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
