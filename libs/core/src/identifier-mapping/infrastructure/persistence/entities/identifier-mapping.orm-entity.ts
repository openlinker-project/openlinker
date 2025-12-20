/**
 * Identifier Mapping ORM Entity
 *
 * TypeORM entity representing the identifier_mappings table in PostgreSQL.
 * Stores mappings between external platform identifiers and internal OpenLinker
 * identifiers. Includes indexes for efficient lookups by external ID and internal ID.
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

@Entity('identifier_mappings')
@Index(['entityType', 'externalId', 'platformId'], { unique: true })
@Index(['entityType', 'internalId'])
export class IdentifierMappingOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  entityType!: string;

  @Column()
  internalId!: string;

  @Column()
  externalId!: string;

  @Column()
  platformId!: string;

  @Column({ type: 'jsonb', nullable: true })
  context!: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

