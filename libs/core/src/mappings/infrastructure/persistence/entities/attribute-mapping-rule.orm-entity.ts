/**
 * Attribute Mapping Rule ORM Entity
 *
 * TypeORM entity for the `attribute_mapping_rules` table (#1841). Scope + target
 * live in real (indexable) columns; the kind-specific configuration is a jsonb
 * `config` blob (discriminated by `kind`). The column + index decorators here
 * mirror the migration so synchronize-built schemas (integration tests) stay in
 * parity with the migration-built production schema.
 *
 * The migration additionally declares `ON DELETE CASCADE` foreign keys from
 * `destination_connection_id` / `source_connection_id` to `connections(id)`.
 * Those FKs are intentionally NOT modeled here as `@ManyToOne` relations — the
 * rule is read connection-scoped by id and never needs to eager-load or
 * navigate to the `Connection` aggregate, so modeling the relation would only
 * add eager-load / relation-hydration churn. The scalar id columns plus the
 * DB-level cascade are sufficient; the FK is a migration-only concern.
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
import {
  AttributeMappingRuleConfig,
  AttributeMappingRuleKind,
} from '../../../domain/types/attribute-mapping-rule.types';

@Entity('attribute_mapping_rules')
@Index('IX_attribute_mapping_rules_destination', ['destinationConnectionId', 'priority'])
export class AttributeMappingRuleOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', name: 'destination_connection_id' })
  destinationConnectionId!: string;

  @Column({ type: 'varchar', length: 255, name: 'destination_parameter_name' })
  destinationParameterName!: string;

  @Column({ type: 'varchar', length: 20, name: 'kind' })
  kind!: AttributeMappingRuleKind;

  @Column({ type: 'jsonb', name: 'config' })
  config!: AttributeMappingRuleConfig;

  @Column({ type: 'int', name: 'priority', default: 0 })
  priority!: number;

  @Column({ type: 'uuid', name: 'source_connection_id', nullable: true })
  sourceConnectionId!: string | null;

  @Column({ type: 'varchar', length: 100, name: 'destination_category_id', nullable: true })
  destinationCategoryId!: string | null;

  @Column({ type: 'varchar', length: 255, name: 'manufacturer_match', nullable: true })
  manufacturerMatch!: string | null;

  @Column({ type: 'varchar', length: 255, name: 'phrase_match', nullable: true })
  phraseMatch!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
