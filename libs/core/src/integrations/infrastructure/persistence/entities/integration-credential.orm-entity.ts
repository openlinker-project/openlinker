/**
 * Integration Credential ORM Entity
 *
 * TypeORM entity for the `integration_credentials` table. Stores the
 * AES-256-GCM-encrypted base64 envelope of the credential payload in
 * `credentialsCiphertext` (#709). The repository is responsible for
 * encryption on write and decryption on read; application services and
 * adapters only ever see the decrypted domain entity.
 *
 * @module libs/core/src/integrations/infrastructure/persistence/entities
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
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

  /**
   * Base64-encoded AES-256-GCM envelope: `nonce[12] || ciphertext || authTag[16]`.
   * Wraps `JSON.stringify(credentialsJson)`. Decrypted to a `Record<string, unknown>`
   * by `IntegrationCredentialRepository.toDomain()`.
   */
  @Column({ type: 'varchar' })
  credentialsCiphertext!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
