/**
 * Integration Credential ORM Entity
 *
 * TypeORM entity representing the integration_credentials table in PostgreSQL.
 * Stores encrypted or unencrypted credentials for integrations. Credentials are
 * stored as JSONB to support platform-specific credential structures.
 *
 * @module libs/core/src/integrations/infrastructure/persistence/entities
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('integration_credentials')
@Index(['ref'], { unique: true })
@Index(['platformType'])
export class IntegrationCredentialOrmEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', unique: true })
  ref!: string;

  @Column()
  platformType!: string;

  @Column({ type: 'jsonb' })
  credentialsJson!: Record<string, unknown>;

  @Column({ type: 'boolean', default: false })
  encrypted!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}


