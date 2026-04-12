/**
 * Connection Service
 *
 * Application service for connection management operations. Wraps the
 * ConnectionPort from core library with validation and error handling.
 * Converts domain exceptions to HTTP exceptions where appropriate.
 *
 * @module apps/api/src/integrations/application/services
 * @implements {IConnectionService}
 * @see {@link IConnectionService} for the interface
 * @see {@link ConnectionPort} for the core port
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { IConnectionService } from '../interfaces/connection.service.interface';
import {
  ConnectionPort,
  Connection,
  ConnectionCreate,
  ConnectionUpdate,
  ConnectionFilters,
  CONNECTION_PORT_TOKEN,
  ConnectionNotFoundException,
} from '@openlinker/core/identifier-mapping';
import {
  IIntegrationsService,
  INTEGRATIONS_SERVICE_TOKEN,
} from '@openlinker/core/integrations';
import {
  JobEnqueuePort,
  JOB_ENQUEUE_TOKEN,
  SyncJobRequest,
} from '@openlinker/core/sync';
import { Inject } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';

@Injectable()
export class ConnectionService implements IConnectionService {
  private readonly logger = new Logger(ConnectionService.name);

  constructor(
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connectionPort: ConnectionPort,
    @Inject(INTEGRATIONS_SERVICE_TOKEN)
    private readonly integrationsService: IIntegrationsService,
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort,
  ) {}

  async create(payload: ConnectionCreate): Promise<Connection> {
    try {
      this.logger.log(`Creating connection: ${payload.name} (platform: ${payload.platformType})`);

      // Resolve adapter metadata to (a) default enabledCapabilities when the
      // caller omits them and (b) validate any explicit subset against the
      // adapter's supportedCapabilities.
      const metadata = await this.integrationsService.resolveAdapterMetadata({
        platformType: payload.platformType,
        adapterKey: payload.adapterKey,
      });

      const enabledCapabilities =
        payload.enabledCapabilities ?? [...metadata.supportedCapabilities];

      const invalid = enabledCapabilities.filter(
        (c) => !metadata.supportedCapabilities.includes(c),
      );
      if (invalid.length > 0) {
        throw new BadRequestException(
          `Capabilities not supported by adapter ${metadata.adapterKey}: ${invalid.join(', ')}`,
        );
      }

      const connection = await this.connectionPort.create({
        ...payload,
        enabledCapabilities,
      });
      this.logger.log(`Connection created successfully: ${connection.id} (${connection.name})`);
      await this.enqueueInitialCatalogSync(connection);
      return connection;
    } catch (error) {
      this.logger.error(`Failed to create connection: ${payload.name}`, error);
      throw error;
    }
  }

  /**
   * Best-effort initial product catalog bootstrap for newly created connections.
   *
   * Enqueues a single master.product.syncAll job when the connection's adapter
   * supports the ProductMaster capability. The idempotency key is stable per
   * connection ID so retries / re-creates with the same ID naturally dedupe — the
   * recurring scheduler (OL_PRODUCT_SYNC_CRON) and the manual "Sync now" button
   * own ongoing re-sync.
   *
   * Failures here MUST NOT fail connection creation: a user has successfully
   * created the connection even if the bootstrap enqueue fails; the scheduler
   * will pick it up at the next cron tick.
   */
  private async enqueueInitialCatalogSync(connection: Connection): Promise<void> {
    try {
      const { metadata } = await this.integrationsService.getAdapter(connection.id);
      if (!metadata.supportedCapabilities.includes('ProductMaster')) {
        return;
      }

      const jobRequest: SyncJobRequest = {
        jobType: 'master.product.syncAll',
        connectionId: connection.id,
        payload: { schemaVersion: 1 },
        idempotencyKey: `bootstrap:${connection.id}:product:syncAll`,
      };

      const { jobId, isExisting } = await this.jobEnqueue.enqueueJob(jobRequest);
      this.logger.log(
        `Bootstrap catalog sync ${isExisting ? 'already enqueued' : 'enqueued'} for connection ${connection.id}: ${jobId}`,
      );
    } catch (error) {
      this.logger.warn(
        `Bootstrap catalog sync skipped for connection ${connection.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async list(filters?: ConnectionFilters): Promise<Connection[]> {
    try {
      this.logger.debug(`Listing connections${filters ? ` with filters: ${JSON.stringify(filters)}` : ''}`);
      const connections = await this.connectionPort.list(filters);
      this.logger.debug(`Found ${connections.length} connection(s)`);
      return connections;
    } catch (error) {
      this.logger.error('Failed to list connections', error);
      throw error;
    }
  }

  async get(connectionId: string): Promise<Connection> {
    try {
      this.logger.debug(`Getting connection: ${connectionId}`);
      const connection = await this.connectionPort.get(connectionId);
      this.logger.debug(`Connection retrieved: ${connection.id} (${connection.name}, status: ${connection.status})`);
      return connection;
    } catch (error) {
      if (error instanceof ConnectionNotFoundException) {
        this.logger.warn(`Connection not found: ${connectionId}`);
        throw new NotFoundException(error.message);
      }
      this.logger.error(`Failed to get connection: ${connectionId}`, error);
      throw error;
    }
  }

  async update(
    connectionId: string,
    patch: ConnectionUpdate,
  ): Promise<Connection> {
    try {
      this.logger.log(`Updating connection: ${connectionId}${patch.status ? ` (status: ${patch.status})` : ''}`);

      const existing = await this.connectionPort.get(connectionId);

      // adapterKey is immutable post-create. Silently accept the unchanged
      // value (so naive round-trip patches work) but reject any real change.
      if (patch.adapterKey !== undefined && patch.adapterKey !== existing.adapterKey) {
        throw new BadRequestException(
          `adapterKey is immutable after connection creation (current: ${existing.adapterKey ?? 'derived from platformType'})`,
        );
      }

      if (patch.enabledCapabilities !== undefined) {
        const metadata = await this.integrationsService.resolveAdapterMetadata({
          platformType: existing.platformType,
          adapterKey: existing.adapterKey,
        });
        const invalid = patch.enabledCapabilities.filter(
          (c) => !metadata.supportedCapabilities.includes(c),
        );
        if (invalid.length > 0) {
          throw new BadRequestException(
            `Capabilities not supported by adapter ${metadata.adapterKey}: ${invalid.join(', ')}`,
          );
        }
      }

      const connection = await this.connectionPort.update(connectionId, patch);
      this.logger.log(`Connection updated successfully: ${connection.id} (status: ${connection.status})`);
      return connection;
    } catch (error) {
      if (error instanceof ConnectionNotFoundException) {
        this.logger.warn(`Connection not found for update: ${connectionId}`);
        throw new NotFoundException(error.message);
      }
      this.logger.error(`Failed to update connection: ${connectionId}`, error);
      throw error;
    }
  }

  async disable(connectionId: string): Promise<Connection> {
    try {
      this.logger.log(`Disabling connection: ${connectionId}`);
      const connection = await this.connectionPort.disable(connectionId);
      this.logger.log(`Connection disabled successfully: ${connection.id} (${connection.name})`);
      return connection;
    } catch (error) {
      if (error instanceof ConnectionNotFoundException) {
        this.logger.warn(`Connection not found for disable: ${connectionId}`);
        throw new NotFoundException(error.message);
      }
      this.logger.error(`Failed to disable connection: ${connectionId}`, error);
      throw error;
    }
  }
}

