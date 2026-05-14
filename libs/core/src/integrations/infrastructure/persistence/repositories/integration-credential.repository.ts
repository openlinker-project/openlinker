/**
 * Integration Credential Repository
 *
 * Persistence implementation of `IntegrationCredentialRepositoryPort`.
 * Encrypts the credential payload via `CryptoService` on write and
 * decrypts on read so callers (`CredentialsResolverService`,
 * `CredentialsWebhookSecretAdapter`, `CredentialsAiProviderAdapter`) only
 * ever see plaintext domain entities (#709). The encrypted-at-rest envelope
 * lives in `IntegrationCredentialOrmEntity.credentialsCiphertext`.
 *
 * @module libs/core/src/integrations/infrastructure/persistence/repositories
 * @implements {IntegrationCredentialRepositoryPort}
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CryptoService } from '@openlinker/shared';
import { Logger } from '@openlinker/shared/logging';

import { IntegrationCredential } from '../../../domain/entities/integration-credential.entity';
import { CredentialNotFoundException } from '../../../domain/exceptions/credential-not-found.exception';
import type {
  CredentialCreate,
  CredentialUpdate,
  IntegrationCredentialRepositoryPort,
} from '../../../domain/ports/integration-credential-repository.port';
import { IntegrationCredentialOrmEntity } from '../entities/integration-credential.orm-entity';

@Injectable()
export class IntegrationCredentialRepository implements IntegrationCredentialRepositoryPort {
  private readonly logger = new Logger(IntegrationCredentialRepository.name);

  constructor(
    @InjectRepository(IntegrationCredentialOrmEntity)
    private readonly repository: Repository<IntegrationCredentialOrmEntity>,
    private readonly crypto: CryptoService,
  ) {}

  async getByRef(ref: string): Promise<IntegrationCredential> {
    const entity = await this.repository.findOne({ where: { ref } });
    if (!entity) {
      throw new CredentialNotFoundException(ref);
    }
    return this.toDomain(entity);
  }

  async create(payload: CredentialCreate): Promise<IntegrationCredential> {
    this.logger.debug(`Creating credential: ${payload.ref} (platform: ${payload.platformType})`);
    const entity = this.toOrm(payload);
    const saved = await this.repository.save(entity);
    const credential = this.toDomain(saved);
    this.logger.log(`Credential created: ${credential.ref} (platform: ${credential.platformType})`);
    return credential;
  }

  async update(ref: string, patch: CredentialUpdate): Promise<IntegrationCredential> {
    const existing = await this.repository.findOne({ where: { ref } });
    if (!existing) {
      throw new CredentialNotFoundException(ref);
    }

    if (patch.credentialsJson !== undefined) {
      existing.credentialsCiphertext = this.crypto.encrypt(JSON.stringify(patch.credentialsJson));
    }

    const saved = await this.repository.save(existing);
    const credential = this.toDomain(saved);
    this.logger.log(`Credential updated: ${credential.ref}`);
    return credential;
  }

  async delete(ref: string): Promise<boolean> {
    const result = await this.repository.delete({ ref });
    const deleted = (result.affected ?? 0) > 0;
    if (deleted) {
      this.logger.log(`Credential deleted: ${ref}`);
    }
    return deleted;
  }

  private toDomain(entity: IntegrationCredentialOrmEntity): IntegrationCredential {
    const plaintext = this.crypto.decrypt(entity.credentialsCiphertext);
    const credentialsJson = JSON.parse(plaintext) as Record<string, unknown>;
    return new IntegrationCredential(
      entity.id,
      entity.ref,
      entity.platformType,
      credentialsJson,
      entity.createdAt,
      entity.updatedAt,
    );
  }

  private toOrm(payload: CredentialCreate): IntegrationCredentialOrmEntity {
    const entity = new IntegrationCredentialOrmEntity();
    entity.ref = payload.ref;
    entity.platformType = payload.platformType;
    entity.credentialsCiphertext = this.crypto.encrypt(JSON.stringify(payload.credentialsJson));
    return entity;
  }
}
