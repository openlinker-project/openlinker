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
import { QueryFailedError } from 'typeorm';
import { IIdentifierMappingService } from './identifier-mapping.service.interface';
import { IdentifierMappingRepositoryPort } from '../../domain/ports/identifier-mapping-repository.port';
import { ConnectionPort } from '../../domain/ports/connection.port';
import { IdentifierMapping } from '../../domain/entities/identifier-mapping.entity';
import { DuplicateIdentifierMappingError } from '../../domain/exceptions/duplicate-identifier-mapping.error';
import { IdentifierMappingConflictException } from '../../domain/exceptions/identifier-mapping-conflict.exception';
import {
  EntityType,
  MappingContext,
  IdentifierMappingRequest,
  ExternalIdMapping,
} from '../../domain/types/identifier-mapping.types';
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

    // Step 3: Generate new internal ID and create mapping
    let internalId = this.generateInternalId(entityType);
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
      // Log error details for debugging
      const errorType = error?.constructor?.name || 'unknown';
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      this.logger.error(
        `Failed to create identifier mapping for ${entityType}:${externalId}@${connectionId}`,
      );
      this.logger.error(`Error type: ${errorType}`);
      this.logger.error(`Error message: ${errorMessage}`);
      if (errorStack) {
        this.logger.error(`Error stack: ${errorStack}`);
      }

      // TODO: Add concurrency handling for duplicate external key errors
      // When concurrent requests try to create the same mapping, handle DuplicateIdentifierMappingError
      // by checking if mapping was created by another request and returning the existing internalId
      if (error instanceof DuplicateIdentifierMappingError) {
        this.logger.error(
          `DuplicateIdentifierMappingError: Mapping already exists for ${entityType}:${externalId}@${connectionId}. This should not happen if initial check worked correctly.`,
        );
        // Re-throw for now - will be handled in future concurrency implementation
        throw error;
      }

      // Handle internal ID collision (very rare)
      // If the generated internal ID already exists for a different external ID, retry once
      if (
        error instanceof QueryFailedError &&
        (error.message.includes('IDX_84b761294149aed081cfba5c95') ||
          (error.message.includes('duplicate key value') &&
            error.message.includes('internalId')))
      ) {
        this.logger.warn(
          `Internal ID collision detected for ${entityType}:${externalId}@${connectionId} (internalId: ${internalId}), generating new ID and retrying...`,
        );
        // Generate new ID and retry once
        internalId = this.generateInternalId(entityType);
        const retryMapping = new IdentifierMapping(
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
          await this.repository.insertMapping(retryMapping);
          this.logger.log(
            `Created new mapping after ID collision retry for ${entityType}:${externalId}@${connectionId} -> ${internalId}`,
          );
          return internalId;
        } catch (retryError) {
          const retryErrorType = retryError?.constructor?.name || 'unknown';
          const retryErrorMessage = retryError instanceof Error ? retryError.message : String(retryError);
          this.logger.error(
            `Retry after ID collision also failed for ${entityType}:${externalId}@${connectionId}`,
          );
          this.logger.error(`Retry error type: ${retryErrorType}`);
          this.logger.error(`Retry error message: ${retryErrorMessage}`);
          throw retryError;
        }
      }

      // Not a retryable error, re-throw
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

    // Create mapping (createMapping already checks for duplicates and throws if exists)
    await this.createMapping(entityType, externalId, connectionId, internalId, context);
    this.logger.debug(
      `Created mapping: ${entityType}:${externalId}@${connectionId} -> ${internalId}`,
    );
    return externalId;

  }

  private generateInternalId(entityType: EntityType): string {
    // Format: ol_{entityTypeLower}_{uuid}
    const uuid = randomUUID().replace(/-/g, '');
    return `ol_${entityType.toLowerCase()}_${uuid}`;
  }
}

