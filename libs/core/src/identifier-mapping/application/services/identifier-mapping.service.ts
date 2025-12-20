/**
 * Identifier Mapping Service
 *
 * Provides centralized identifier mapping between external platform identifiers
 * (e.g., PrestaShop product ID, Allegro order ID) and internal OpenLinker identifiers.
 * Implements get-or-create semantics for internal identifiers and bidirectional mapping
 * between external and internal identifiers. Used by all adapters to replace external
 * IDs with internal IDs during data transformation.
 *
 * The service resolves platformType from Connection internally, ensuring consistency
 * and supporting multiple integrations of the same platform type.
 *
 * @module libs/core/src/identifier-mapping/application/services
 * @implements {IIdentifierMappingService}
 * @see {@link IdentifierMappingPort} for the service port interface
 * @see {@link IdentifierMappingRepositoryPort} for persistence port
 * @see {@link ConnectionPort} for Connection resolution
 */
import { Injectable, Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { IIdentifierMappingService } from './identifier-mapping.service.interface';
import { IdentifierMappingRepositoryPort } from '@openlinker/core/identifier-mapping/domain/ports/identifier-mapping-repository.port';
import { ConnectionPort } from '@openlinker/core/identifier-mapping/domain/ports/connection.port';
import { IdentifierMapping } from '@openlinker/core/identifier-mapping/domain/entities/identifier-mapping.entity';
import { DuplicateIdentifierMappingError } from '@openlinker/core/identifier-mapping/domain/exceptions/duplicate-identifier-mapping.error';
import {
  EntityType,
  MappingContext,
  IdentifierMappingRequest,
  ExternalIdMapping,
} from '@openlinker/core/identifier-mapping/domain/types/identifier-mapping.types';
import { Logger } from '@openlinker/shared/logging';
import { IDENTIFIER_MAPPING_REPOSITORY_TOKEN, CONNECTION_PORT_TOKEN } from '../../identifier-mapping.tokens';

@Injectable()
export class IdentifierMappingService implements IIdentifierMappingService {
  private readonly logger = new Logger(IdentifierMappingService.name);

  constructor(
    @Inject(IDENTIFIER_MAPPING_REPOSITORY_TOKEN)
    private readonly repository: IdentifierMappingRepositoryPort,
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connectionPort: ConnectionPort,
  ) {}

  async getOrCreateInternalId(
    entityType: EntityType,
    externalId: string,
    connectionId: string,
    context?: MappingContext,
  ): Promise<string> {
    // Step 1: Resolve Connection and derive platformType
    const connection = await this.connectionPort.get(connectionId);
    const platformType = connection.platformType;

    // Step 2: Check if mapping already exists
    const existing = await this.repository.findByExternalKey(
      entityType,
      platformType,
      connectionId,
      externalId,
    );
    if (existing) {
      this.logger.debug(
        `Found existing mapping for ${entityType}:${externalId}@${connectionId} -> ${existing.internalId}`,
      );
      return existing.internalId;
    }

    // Step 3: Generate new internal ID
    const internalId = this.generateInternalId(entityType);

    // Step 4: Create mapping with concurrency-safe insert
    const mapping = new IdentifierMapping(
      randomUUID(),
      entityType,
      internalId,
      externalId,
      platformType,
      connectionId,
      context ?? null,
      new Date(),
      new Date(),
    );

    try {
      await this.repository.insertMapping(mapping);
      this.logger.log(
        `Created new mapping for ${entityType}:${externalId}@${connectionId} -> ${internalId}`,
      );
      return internalId;
    } catch (error) {
      // Step 5: Handle unique violation (concurrency case)
      if (error instanceof DuplicateIdentifierMappingError) {
        // Retry: select and return winner
        const winner = await this.repository.findByExternalKey(
          entityType,
          platformType,
          connectionId,
          externalId,
        );
        if (winner) {
          this.logger.debug(
            `Concurrent insert detected, returning existing mapping for ${entityType}:${externalId}@${connectionId} -> ${winner.internalId}`,
          );
          return winner.internalId;
        }
      }
      // Re-throw if not a duplicate error or if winner not found
      throw error;
    }
  }

  async getInternalId(
    entityType: EntityType,
    externalId: string,
    connectionId: string,
  ): Promise<string | null> {
    // Resolve Connection and derive platformType
    const connection = await this.connectionPort.get(connectionId);
    const platformType = connection.platformType;

    const mapping = await this.repository.findByExternalKey(
      entityType,
      platformType,
      connectionId,
      externalId,
    );
    return mapping?.internalId ?? null;
  }

  async getExternalIds(
    entityType: EntityType,
    internalId: string,
  ): Promise<ExternalIdMapping[]> {
    const mappings = await this.repository.findByInternalId(entityType, internalId);
    return mappings.map((m) => ({
      externalId: m.externalId,
      platformType: m.platformType,
      connectionId: m.connectionId,
      entityType: m.entityType,
    }));
  }

  async createMapping(
    entityType: EntityType,
    externalId: string,
    connectionId: string,
    internalId: string,
    context?: MappingContext,
  ): Promise<void> {
    // Resolve Connection and derive platformType
    const connection = await this.connectionPort.get(connectionId);
    const platformType = connection.platformType;

    const existing = await this.repository.findByExternalKey(
      entityType,
      platformType,
      connectionId,
      externalId,
    );
    if (existing) {
      throw new Error(
        `Mapping already exists for ${entityType}:${externalId}@${connectionId} -> ${existing.internalId}`,
      );
    }

    const mapping = new IdentifierMapping(
      randomUUID(),
      entityType,
      internalId,
      externalId,
      platformType,
      connectionId,
      context ?? null,
      new Date(),
      new Date(),
    );

    await this.repository.create(mapping);
  }

  async batchGetOrCreateInternalIds(
    requests: IdentifierMappingRequest[],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();

    // Group by connectionId to batch Connection lookups
    const connectionIds = [...new Set(requests.map((r) => r.connectionId))];
    const connections = await Promise.all(
      connectionIds.map((id) => this.connectionPort.get(id)),
    );
    const connectionMap = new Map(connections.map((c) => [c.id, c]));

    // Process items with resolved platformType (avoid redundant connection lookups)
    await Promise.all(
      requests.map(async (request) => {
        const connection = connectionMap.get(request.connectionId);
        if (!connection) {
          throw new Error(`Connection not found: ${request.connectionId}`);
        }

        // Use internal helper that accepts resolved platformType
        const internalId = await this.getOrCreateInternalIdWithPlatform(
          request.entityType,
          request.externalId,
          request.connectionId,
          connection.platformType,
          request.context,
        );

        // Use composite key: externalId:connectionId
        const compositeKey = `${request.externalId}:${request.connectionId}`;
        result.set(compositeKey, internalId);
      }),
    );

    return result;
  }

  /**
   * Internal helper for get-or-create with resolved platformType
   * Used by batch operations to avoid redundant connection lookups
   * @private
   */
  private async getOrCreateInternalIdWithPlatform(
    entityType: EntityType,
    externalId: string,
    connectionId: string,
    platformType: string,
    context?: MappingContext,
  ): Promise<string> {
    // Check if mapping already exists
    const existing = await this.repository.findByExternalKey(
      entityType,
      platformType,
      connectionId,
      externalId,
    );
    if (existing) {
      this.logger.debug(
        `Found existing mapping for ${entityType}:${externalId}@${connectionId} -> ${existing.internalId}`,
      );
      return existing.internalId;
    }

    // Generate new internal ID
    const internalId = this.generateInternalId(entityType);

    // Create mapping with concurrency-safe insert
    const mapping = new IdentifierMapping(
      randomUUID(),
      entityType,
      internalId,
      externalId,
      platformType,
      connectionId,
      context ?? null,
      new Date(),
      new Date(),
    );

    try {
      await this.repository.insertMapping(mapping);
      this.logger.log(
        `Created new mapping for ${entityType}:${externalId}@${connectionId} -> ${internalId}`,
      );
      return internalId;
    } catch (error) {
      // Handle unique violation (concurrency case)
      if (error instanceof DuplicateIdentifierMappingError) {
        // Retry: select and return winner
        const winner = await this.repository.findByExternalKey(
          entityType,
          platformType,
          connectionId,
          externalId,
        );
        if (winner) {
          this.logger.debug(
            `Concurrent insert detected, returning existing mapping for ${entityType}:${externalId}@${connectionId} -> ${winner.internalId}`,
          );
          return winner.internalId;
        }
      }
      // Re-throw if not a duplicate error or if winner not found
      throw error;
    }
  }

  private generateInternalId(entityType: EntityType): string {
    // Format: ol_{entityTypeLower}_{uuid}
    const uuid = randomUUID().replace(/-/g, '');
    return `ol_${entityType.toLowerCase()}_${uuid}`;
  }
}

