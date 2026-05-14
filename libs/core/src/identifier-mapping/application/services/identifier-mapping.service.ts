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
import type { IIdentifierMappingService } from './identifier-mapping.service.interface';
import { IdentifierMappingRepositoryPort } from '../../domain/ports/identifier-mapping-repository.port';
import { ConnectionPort } from '../../domain/ports/connection.port';
import { IdentifierMapping } from '../../domain/entities/identifier-mapping.entity';
import { DuplicateIdentifierMappingError } from '../../domain/exceptions/duplicate-identifier-mapping.error';
import { MappingAlreadyExistsError } from '../../domain/exceptions/mapping-already-exists.error';
import { IdentifierMappingConflictException } from '../../domain/exceptions/identifier-mapping-conflict.exception';
import type {
  MappingContext,
  IdentifierMappingRequest,
  ExternalIdMapping,
} from '../../domain/types/identifier-mapping.types';
import { ENTITY_TYPE_ID_PREFIX } from '../../domain/types/identifier-mapping.types';
import {
  IDENTIFIER_MAPPING_REPOSITORY_TOKEN,
  CONNECTION_PORT_TOKEN,
} from '../../identifier-mapping.tokens';

@Injectable()
export class IdentifierMappingService implements IIdentifierMappingService {
  private readonly logger = new Logger(IdentifierMappingService.name);

  constructor(
    @Inject(IDENTIFIER_MAPPING_REPOSITORY_TOKEN)
    private readonly repository: IdentifierMappingRepositoryPort,
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connectionPort: ConnectionPort
  ) {}

  async getOrCreateInternalId(
    entityType: string,
    externalId: string,
    connectionId: string,
    context?: MappingContext
  ): Promise<string> {
    const connection = await this.connectionPort.get(connectionId);
    return this.getOrCreateInternalIdWithPlatform(
      entityType,
      externalId,
      connectionId,
      connection.platformType,
      context
    );
  }

  async getInternalId(
    entityType: string,
    externalId: string,
    connectionId: string
  ): Promise<string | null> {
    // Resolve Connection and derive platformType
    const connection = await this.connectionPort.get(connectionId);
    const platformType = connection.platformType;

    const mapping = await this.repository.findByExternalKey(
      entityType,
      platformType,
      connectionId,
      externalId
    );
    return mapping?.internalId ?? null;
  }

  async getExternalIds(entityType: string, internalId: string): Promise<ExternalIdMapping[]> {
    const mappings = await this.repository.findByInternalId(entityType, internalId);
    return mappings.map((m) => ({
      externalId: m.externalId,
      platformType: m.platformType,
      connectionId: m.connectionId,
      entityType: m.entityType,
    }));
  }

  /**
   * Create an explicit mapping. Concurrency-safe via insert-then-recover.
   *
   * @throws MappingAlreadyExistsError when a mapping already exists for the
   *   `(entityType, externalId, connectionId)` triple — whether pre-existing
   *   or inserted concurrently.
   * @throws DuplicateIdentifierMappingError in the rare insert-fails-then-
   *   winner-deleted window: `insertMapping` raises a unique-violation but
   *   the follow-up `findByExternalKey` returns null because the winner row
   *   was deleted between the two calls. Callers that only catch
   *   `MappingAlreadyExistsError` should let this propagate.
   */
  async createMapping(
    entityType: string,
    externalId: string,
    connectionId: string,
    internalId: string,
    context?: MappingContext
  ): Promise<void> {
    const connection = await this.connectionPort.get(connectionId);
    const platformType = connection.platformType;

    const mapping = new IdentifierMapping(
      randomUUID(),
      entityType,
      internalId,
      externalId,
      platformType,
      connectionId,
      context ?? null,
      new Date(),
      new Date()
    );

    try {
      await this.repository.insertMapping(mapping);
    } catch (error) {
      if (error instanceof DuplicateIdentifierMappingError) {
        const winner = await this.repository.findByExternalKey(
          entityType,
          platformType,
          connectionId,
          externalId
        );
        if (winner) {
          throw new MappingAlreadyExistsError(
            entityType,
            externalId,
            connectionId,
            winner.internalId
          );
        }
      }
      throw error;
    }
  }

  async deleteMapping(entityType: string, externalId: string, connectionId: string): Promise<void> {
    const connection = await this.connectionPort.get(connectionId);
    const platformType = connection.platformType;
    await this.repository.deleteByExternalKey(entityType, platformType, connectionId, externalId);
    this.logger.debug(
      `Deleted mapping for ${entityType}:${externalId}@${connectionId} (platform=${platformType})`
    );
  }

  async listExternalIdsByConnection(entityType: string, connectionId: string): Promise<string[]> {
    const mappings = await this.repository.findByEntityTypeAndConnection(entityType, connectionId);
    return mappings.map((m) => m.externalId);
  }

  async batchGetOrCreateInternalIds(
    requests: IdentifierMappingRequest[]
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();

    // Group by connectionId to batch Connection lookups
    const connectionIds = [...new Set(requests.map((r) => r.connectionId))];
    const connections = await Promise.all(connectionIds.map((id) => this.connectionPort.get(id)));
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
          request.context
        );

        // Use composite key: externalId:connectionId
        const compositeKey = `${request.externalId}:${request.connectionId}`;
        result.set(compositeKey, internalId);
      })
    );

    return result;
  }

  /**
   * Internal helper for get-or-create with resolved platformType.
   * Used by batch operations to avoid redundant connection lookups.
   *
   * Pure insert-then-recover: always attempts insert (no upfront read), and
   * handles duplicate mappings — pre-existing or from concurrent insert — by
   * SELECTing the winner. Pattern matches docs/engineering-standards.md §
   * "Error handling in concurrent operations". Eliminating the upfront read
   * is a deliberate trade-off — repeat lookups now pay one insert attempt
   * against a unique index in exchange for closing the race-window contract
   * literally. Callers that need raw-read performance should use
   * `getInternalId` directly.
   *
   * Does NOT retry on internal-id collisions. UUID collisions are
   * astronomically rare; if one occurs the error propagates to the caller.
   * @private
   */
  private async getOrCreateInternalIdWithPlatform(
    entityType: string,
    externalId: string,
    connectionId: string,
    platformType: string,
    context?: MappingContext
  ): Promise<string> {
    const internalId = this.generateInternalId(entityType);
    const mapping = new IdentifierMapping(
      randomUUID(),
      entityType,
      internalId,
      externalId,
      platformType,
      connectionId,
      context ?? null,
      new Date(),
      new Date()
    );

    try {
      await this.repository.insertMapping(mapping);
      this.logger.log(
        `Created new mapping for ${entityType}:${externalId}@${connectionId} -> ${internalId}`
      );
      return internalId;
    } catch (error) {
      if (error instanceof DuplicateIdentifierMappingError) {
        const winner = await this.repository.findByExternalKey(
          entityType,
          platformType,
          connectionId,
          externalId
        );
        if (winner) {
          this.logger.debug(
            `Mapping already exists for ${entityType}:${externalId}@${connectionId} -> ${winner.internalId}`
          );
          return winner.internalId;
        }
      }
      throw error;
    }
  }

  /**
   * Get or create an exact mapping between an external identifier and a
   * caller-supplied internal identifier. Concurrency-safe via insert-then-
   * recover.
   *
   * @returns the external ID when the mapping was created or already exists
   *   with the requested internal ID.
   * @throws IdentifierMappingConflictException when the external ID is
   *   already mapped to a *different* internal ID.
   */
  async getOrCreateExactMapping(
    entityType: string,
    externalId: string,
    internalId: string,
    connectionId: string,
    context?: MappingContext
  ): Promise<string> {
    const connection = await this.connectionPort.get(connectionId);
    const platformType = connection.platformType;

    const mapping = new IdentifierMapping(
      randomUUID(),
      entityType,
      internalId,
      externalId,
      platformType,
      connectionId,
      context ?? null,
      new Date(),
      new Date()
    );

    try {
      await this.repository.insertMapping(mapping);
      this.logger.debug(
        `Created mapping: ${entityType}:${externalId}@${connectionId} -> ${internalId}`
      );
      return externalId;
    } catch (error) {
      if (error instanceof DuplicateIdentifierMappingError) {
        const winner = await this.repository.findByExternalKey(
          entityType,
          platformType,
          connectionId,
          externalId
        );
        if (winner) {
          if (winner.internalId === internalId) {
            this.logger.debug(
              `Mapping already exists: ${entityType}:${externalId}@${connectionId} -> ${internalId}`
            );
            return externalId;
          }
          throw new IdentifierMappingConflictException(
            entityType,
            externalId,
            connectionId,
            winner.internalId,
            internalId
          );
        }
      }
      throw error;
    }
  }

  private generateInternalId(entityType: string): string {
    // Format: ol_{prefix}_{uuid} — prefix defaults to entityType.toLowerCase()
    // unless overridden in ENTITY_TYPE_ID_PREFIX (e.g. ProductVariant → 'variant').
    // The override map is keyed by CoreEntityType; widen to a string index here
    // so plugin-registered entity types (#577) fall through to the default
    // lowercased prefix instead of failing the indexed access.
    const overrides: Record<string, string | undefined> = ENTITY_TYPE_ID_PREFIX;
    const uuid = randomUUID().replace(/-/g, '');
    const prefix = overrides[entityType] ?? entityType.toLowerCase();
    return `ol_${prefix}_${uuid}`;
  }
}
