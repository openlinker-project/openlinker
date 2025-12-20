/**
 * Identifier Mapping ORM Entity
 *
 * TypeORM entity representing the identifier_mappings table in PostgreSQL.
 * Stores mappings between external platform identifiers and internal OpenLinker
 * identifiers. Includes indexes for efficient lookups by external ID and internal ID.
 *
 * The entity includes both `platformType` (denormalized for performance) and
 * `connectionId` (references connections.id) to support multiple integrations
 * of the same platform type.
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
@Index(['entityType', 'platformType', 'connectionId', 'externalId'], {
  unique: true,
})
@Index(['entityType', 'internalId'], { unique: true })
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
  platformType!: string;

  @Column('uuid')
  connectionId!: string;

  @Column({ type: 'jsonb', nullable: true })
  context!: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

