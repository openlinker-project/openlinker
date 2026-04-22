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
import { Logger } from '@openlinker/shared/logging';
import { IIdentifierMappingService } from './identifier-mapping.service.interface';
import { IdentifierMappingRepositoryPort } from '../../domain/ports/identifier-mapping-repository.port';
import { ConnectionPort } from '../../domain/ports/connection.port';
import { IdentifierMapping } from '../../domain/entities/identifier-mapping.entity';
import { DuplicateIdentifierMappingError } from '../../domain/exceptions/duplicate-identifier-mapping.error';
import { MappingAlreadyExistsError } from '../../domain/exceptions/mapping-already-exists.error';
import { IdentifierMappingConflictException } from '../../domain/exceptions/identifier-mapping-conflict.exception';
import {
  EntityType,
  ENTITY_TYPE_ID_PREFIX,
  MappingContext,
  IdentifierMappingRequest,
  ExternalIdMapping,
} from '../../domain/types/identifier-mapping.types';
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
    const connection = await this.connectionPort.get(connectionId);
    return this.getOrCreateInternalIdWithPlatform(
      entityType,
      externalId,
      connectionId,
      connection.platformType,
      context,
    );
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
      throw new MappingAlreadyExistsError(entityType, externalId, connectionId, existing.internalId);
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

  async deleteMapping(
    entityType: EntityType,
    externalId: string,
    connectionId: string,
  ): Promise<void> {
    const connection = await this.connectionPort.get(connectionId);
    const platformType = connection.platformType;
    await this.repository.deleteByExternalKey(
      entityType,
      platformType,
      connectionId,
      externalId,
    );
    this.logger.debug(
      `Deleted mapping for ${entityType}:${externalId}@${connectionId} (platform=${platformType})`,
    );
  }

  async listExternalIdsByConnection(
    entityType: EntityType,
    connectionId: string,
  ): Promise<string[]> {
    const mappings = await this.repository.findByEntityTypeAndConnection(
      entityType,
      connectionId,
    );
    return mappings.map((m) => m.externalId);
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

    // Process items with resolved platformType (avoid redundant connection lookups).
    // Note: all requests are issued concurrently. This is intentional for the current
    // use case where batch sizes are small (typically < 50 items per job). If batch
    // sizes grow significantly, consider chunking to limit DB concurrency.
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
   * Internal helper for get-or-create with resolved platformType.
   * Used by batch operations to avoid redundant connection lookups.
   *
   * Note: this helper handles DuplicateIdentifierMappingError (concurrent insert) but
   * does NOT retry on InternalIdCollisionError. Internal ID collisions are astronomically
   * rare with UUID generation; if one occurs here the error propagates to the caller.
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

  /**
   * Get or create exact mapping between external and internal identifiers
   * Returns the external ID if mapping exists or was created successfully
   */
  async getOrCreateExactMapping(
    entityType: EntityType,
    externalId: string,
    internalId: string,
    connectionId: string,
    context?: MappingContext,
  ): Promise<string> {
    // Resolve Connection and derive platformType
    const connection = await this.connectionPort.get(connectionId);
    const platformType = connection.platformType;

    // Check if mapping already exists
    const existing = await this.repository.findByExternalKey(
      entityType,
      platformType,
      connectionId,
      externalId,
    );
    if (existing) {
      if (existing.internalId === internalId) {
        // Perfect match - mapping already exists
        this.logger.debug(
          `Mapping already exists: ${entityType}:${externalId}@${connectionId} -> ${internalId}`,
        );
        return externalId;
      }
      // Conflict: external ID mapped to different internal ID
      throw new IdentifierMappingConflictException(
        entityType,
        externalId,
        connectionId,
        existing.internalId,
        internalId,
      );
    }

    // Create mapping (createMapping already checks for duplicates and throws if exists).
    // TODO: this path is not concurrency-safe — concurrent calls can race between the
    // findByExternalKey check above and repository.create() below, producing a raw
    // QueryFailedError instead of a domain error. Fix if concurrent createMapping calls
    // become a realistic scenario.
    await this.createMapping(entityType, externalId, connectionId, internalId, context);
    this.logger.debug(
      `Created mapping: ${entityType}:${externalId}@${connectionId} -> ${internalId}`,
    );
    return externalId;

  }

  private generateInternalId(entityType: EntityType): string {
    // Format: ol_{prefix}_{uuid} — prefix defaults to entityType.toLowerCase()
    // unless overridden in ENTITY_TYPE_ID_PREFIX (e.g. ProductVariant → 'variant').
    const uuid = randomUUID().replace(/-/g, '');
    const prefix = ENTITY_TYPE_ID_PREFIX[entityType] ?? entityType.toLowerCase();
    return `ol_${prefix}_${uuid}`;
  }
}

