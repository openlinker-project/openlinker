/**
 * Integration Credential Repository
 *
 * Repository implementation for IntegrationCredential persistence operations.
 * Provides data access methods for CRUD operations on credentials, with conversion
 * between domain entities and ORM entities. Implements IntegrationCredentialRepositoryPort
 * interface for use by the credentials resolver service.
 *
 * @module libs/core/src/integrations/infrastructure/persistence/repositories
 * @implements {IntegrationCredentialRepositoryPort}
 * @see {@link IntegrationCredentialOrmEntity} for the database entity
 * @see {@link IntegrationCredentialRepositoryPort} for the port interface
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IntegrationCredentialOrmEntity } from '../entities/integration-credential.orm-entity';
import { IntegrationCredential } from '../../../domain/entities/integration-credential.entity';
import {
  IntegrationCredentialRepositoryPort,
  CredentialCreate,
  CredentialUpdate,
} from '../../../domain/ports/integration-credential-repository.port';
import { CredentialNotFoundException } from '../../../domain/exceptions/credential-not-found.exception';
import { Logger } from '@openlinker/shared/logging';

@Injectable()
export class IntegrationCredentialRepository implements IntegrationCredentialRepositoryPort {
  private readonly logger = new Logger(IntegrationCredentialRepository.name);

  constructor(
    @InjectRepository(IntegrationCredentialOrmEntity)
    private readonly repository: Repository<IntegrationCredentialOrmEntity>,
  ) {}

  async getByRef(ref: string): Promise<IntegrationCredential> {
    const entity = await this.repository.findOne({
      where: { ref },
    });

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
    // Load existing entity
    const existing = await this.repository.findOne({
      where: { ref },
    });

    if (!existing) {
      throw new CredentialNotFoundException(ref);
    }

    // Apply patch
    if (patch.credentialsJson !== undefined) {
      existing.credentialsJson = patch.credentialsJson;
    }
    if (patch.encrypted !== undefined) {
      existing.encrypted = patch.encrypted;
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

  /**
   * Convert ORM entity to domain entity
   */
  private toDomain(entity: IntegrationCredentialOrmEntity): IntegrationCredential {
    return new IntegrationCredential(
      entity.id,
      entity.ref,
      entity.platformType,
      entity.credentialsJson,
      entity.encrypted,
      entity.createdAt,
      entity.updatedAt,
    );
  }

  /**
   * Convert creation payload to ORM entity
   */
  private toOrm(payload: CredentialCreate): IntegrationCredentialOrmEntity {
    const entity = new IntegrationCredentialOrmEntity();
    entity.ref = payload.ref;
    entity.platformType = payload.platformType;
    entity.credentialsJson = payload.credentialsJson;
    entity.encrypted = payload.encrypted ?? false;
    return entity;
  }
}

