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
import { randomUUID } from 'node:crypto';
import { IConnectionService } from '../interfaces/connection.service.interface';
import { ConnectionCreateInput } from '../interfaces/connection.service.types';
import { validateCredentialsShape } from '../credentials/credential-shape.validator';
import {
  ConnectionPort,
  Connection,
  ConnectionUpdate,
  ConnectionFilters,
  CONNECTION_PORT_TOKEN,
  ConnectionNotFoundException,
} from '@openlinker/core/identifier-mapping';
import {
  IIntegrationsService,
  INTEGRATIONS_SERVICE_TOKEN,
  IntegrationCredentialRepositoryPort,
  INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN,
  ConnectionTesterRegistryService,
  CONNECTION_TESTER_REGISTRY_TOKEN,
  CREDENTIALS_RESOLVER_TOKEN,
  CredentialsResolverPort,
  ConnectionTestResult,
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
    @Inject(INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN)
    private readonly credentialRepository: IntegrationCredentialRepositoryPort,
    @Inject(CONNECTION_TESTER_REGISTRY_TOKEN)
    private readonly connectionTesterRegistry: ConnectionTesterRegistryService,
    @Inject(CREDENTIALS_RESOLVER_TOKEN)
    private readonly credentialsResolver: CredentialsResolverPort,
  ) {}

  async testConnection(connectionId: string): Promise<ConnectionTestResult> {
    const connection = await this.get(connectionId);
    const metadata = await this.integrationsService.resolveAdapterMetadata({
      platformType: connection.platformType,
      adapterKey: connection.adapterKey,
    });
    const tester = this.connectionTesterRegistry.get(metadata.adapterKey);
    if (!tester) {
      throw new BadRequestException(
        `Connection testing is not supported for adapter ${metadata.adapterKey}`,
      );
    }
    this.logger.log(
      `Testing connection ${connectionId} (adapter: ${metadata.adapterKey})`,
    );
    const result = await tester.test(connection, this.credentialsResolver);
    this.logger.log(
      `Connection test ${result.success ? 'succeeded' : 'failed'} for ${connectionId} in ${result.latencyMs}ms` +
        (result.status !== undefined ? ` (status=${result.status})` : ''),
    );
    return result;
  }

  async create(payload: ConnectionCreateInput): Promise<Connection> {
    const { credentials, credentialsRef, ...rest } = payload;

    if ((credentials && credentialsRef) || (!credentials && !credentialsRef)) {
      throw new BadRequestException(
        'Exactly one of `credentials` or `credentialsRef` must be provided',
      );
    }
    if (credentialsRef && !credentialsRef.startsWith('db:')) {
      throw new BadRequestException(
        'credentialsRef must start with "db:" — raw keys are no longer accepted',
      );
    }

    try {
      this.logger.log(`Creating connection: ${rest.name} (platform: ${rest.platformType})`);

      const metadata = await this.integrationsService.resolveAdapterMetadata({
        platformType: rest.platformType,
        adapterKey: rest.adapterKey,
      });

      const enabledCapabilities =
        rest.enabledCapabilities ?? [...metadata.supportedCapabilities];

      const invalid = enabledCapabilities.filter(
        (c) => !metadata.supportedCapabilities.includes(c),
      );
      if (invalid.length > 0) {
        throw new BadRequestException(
          `Capabilities not supported by adapter ${metadata.adapterKey}: ${invalid.join(', ')}`,
        );
      }

      // Persist credentials if the caller supplied raw values. We write the
      // credential row *before* the connection row so the connection is never
      // persisted pointing at a missing credential. If connection creation
      // fails afterwards we best-effort delete the credential to avoid leaks.
      let resolvedCredentialsRef = credentialsRef;
      let createdCredentialRef: string | null = null;
      if (credentials) {
        validateCredentialsShape(rest.platformType, credentials);
        const ref = randomUUID();
        await this.credentialRepository.create({
          ref,
          platformType: rest.platformType,
          credentialsJson: credentials,
        });
        createdCredentialRef = ref;
        resolvedCredentialsRef = `db:${ref}`;
        this.logger.log(
          `Persisted credentials for new ${rest.platformType} connection (ref: db:${ref})`,
        );
      }

      let connection: Connection;
      try {
        connection = await this.connectionPort.create({
          ...rest,
          credentialsRef: resolvedCredentialsRef!,
          enabledCapabilities,
        });
      } catch (error) {
        if (createdCredentialRef) {
          try {
            await this.credentialRepository.delete(createdCredentialRef);
            this.logger.warn(
              `Rolled back orphaned credential ${createdCredentialRef} after connection create failure`,
            );
          } catch (cleanupError) {
            this.logger.error(
              `Failed to roll back orphaned credential ${createdCredentialRef}: ${(cleanupError as Error).message}`,
            );
          }
        }
        throw error;
      }

      this.logger.log(`Connection created successfully: ${connection.id} (${connection.name})`);
      await this.enqueueInitialCatalogSync(connection);
      return connection;
    } catch (error) {
      this.logger.error(`Failed to create connection: ${rest.name}`, error);
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

  async updateCredentials(
    connectionId: string,
    credentials: Record<string, unknown>,
  ): Promise<void> {
    const connection = await this.get(connectionId);
    if (!connection.credentialsRef.startsWith('db:')) {
      throw new BadRequestException(
        `Connection ${connectionId} does not have a db-backed credentials reference ` +
          `(current: ${connection.credentialsRef}); in-place credential rotation is not supported`,
      );
    }
    validateCredentialsShape(connection.platformType, credentials);
    const ref = connection.credentialsRef.slice('db:'.length);
    await this.credentialRepository.update(ref, { credentialsJson: credentials });
    this.logger.log(`Rotated credentials for connection ${connectionId}`);
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

