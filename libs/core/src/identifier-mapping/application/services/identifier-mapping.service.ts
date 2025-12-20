/* eslint-disable @typescript-eslint/unbound-method */
/**
 * Identifier Mapping Service
 *
 * Provides centralized identifier mapping between external platform identifiers
 * (e.g., PrestaShop product ID, Allegro order ID) and internal OpenLinker identifiers.
 * Implements get-or-create semantics for internal identifiers and bidirectional mapping
 * between external and internal identifiers. Used by all adapters to replace external
 * IDs with internal IDs during data transformation.
 *
 * @module libs/core/src/identifier-mapping/application/services
 * @implements {IIdentifierMappingService}
 * @see {@link IdentifierMappingPort} for the port interface
 * @see {@link IdentifierMappingRepository} for persistence implementation
 */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { IIdentifierMappingService } from './identifier-mapping.service.interface';
import { IdentifierMappingRepository } from '@openlinker/core/identifier-mapping/infrastructure/persistence/repositories/identifier-mapping.repository';
import { IdentifierMapping } from '@openlinker/core/identifier-mapping/domain/entities/identifier-mapping.entity';
import {
  EntityType,
  MappingContext,
  IdentifierMappingRequest,
  ExternalIdMapping,
} from '@openlinker/core/identifier-mapping/domain/types/identifier-mapping.types';
import { Logger } from '@openlinker/shared/logging';

@Injectable()
export class IdentifierMappingService implements IIdentifierMappingService {
  private readonly logger = new Logger(IdentifierMappingService.name);

  constructor(private readonly repository: IdentifierMappingRepository) {}

  async getOrCreateInternalId(
    entityType: EntityType,
    externalId: string,
    platformId: string,
    context?: MappingContext,
  ): Promise<string> {
    // Check if mapping already exists
    const existing = await this.repository.findByExternalId(entityType, externalId, platformId);
    if (existing) {
      this.logger.debug(
        `Found existing mapping for ${entityType}:${externalId}@${platformId} -> ${existing.internalId}`,
      );
      return existing.internalId;
    }

    // Generate new internal ID
    const internalId = this.generateInternalId(entityType);

    // Create mapping
    const mapping = new IdentifierMapping(
      randomUUID(),
      entityType,
      internalId,
      externalId,
      platformId,
      context ?? null,
      new Date(),
      new Date(),
    );

    await this.repository.create(mapping);

    this.logger.log(
      `Created new mapping for ${entityType}:${externalId}@${platformId} -> ${internalId}`,
    );

    return internalId;
  }

  async getInternalId(
    entityType: EntityType,
    externalId: string,
    platformId: string,
  ): Promise<string | null> {
    const mapping = await this.repository.findByExternalId(entityType, externalId, platformId);
    return mapping?.internalId ?? null;
  }

  async getExternalIds(
    entityType: EntityType,
    internalId: string,
  ): Promise<ExternalIdMapping[]> {
    const mappings = await this.repository.findByInternalId(entityType, internalId);
    return mappings.map((m) => ({
      externalId: m.externalId,
      platformId: m.platformId,
      entityType: m.entityType,
    }));
  }

  async createMapping(
    entityType: EntityType,
    externalId: string,
    platformId: string,
    internalId: string,
  ): Promise<void> {
    const existing = await this.repository.findByExternalId(entityType, externalId, platformId);
    if (existing) {
      throw new Error(
        `Mapping already exists for ${entityType}:${externalId}@${platformId} -> ${existing.internalId}`,
      );
    }

    const mapping = new IdentifierMapping(
      randomUUID(),
      entityType,
      internalId,
      externalId,
      platformId,
      null,
      new Date(),
      new Date(),
    );

    await this.repository.create(mapping);
  }

  async batchGetOrCreateInternalIds(
    requests: IdentifierMappingRequest[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();

    // Process in parallel
    await Promise.all(
      requests.map(async (request) => {
        const internalId = await this.getOrCreateInternalId(
          request.entityType,
          request.externalId,
          request.platformId,
          request.context,
        );
        result.set(request.externalId, internalId);
      }),
    );

    return result;
  }

  private generateInternalId(entityType: EntityType): string {
    // Format: ol_{entityType}_{uuid}
    const uuid = randomUUID().replace(/-/g, '');
    return `ol_${entityType.toLowerCase()}_${uuid}`;
  }
}
/* eslint-enable @typescript-eslint/unbound-method */

