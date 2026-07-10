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
import type { IConnectionService } from '../interfaces/connection.service.interface';
import type { ConnectionCreateInput } from '../interfaces/connection.service.types';
import type {
  Connection,
  ConnectionUpdate,
  ConnectionFilters,
} from '@openlinker/core/identifier-mapping';
import {
  ConnectionPort,
  CONNECTION_PORT_TOKEN,
  ConnectionNotFoundException,
} from '@openlinker/core/identifier-mapping';
import type {
  ConnectionTestResult,
  WebhookProvisioningResult,
} from '@openlinker/core/integrations';
import {
  IIntegrationsService,
  INTEGRATIONS_SERVICE_TOKEN,
  ICredentialsService,
  CREDENTIALS_SERVICE_TOKEN,
  ConnectionTesterRegistryService,
  CONNECTION_TESTER_REGISTRY_TOKEN,
  CREDENTIALS_RESOLVER_TOKEN,
  CredentialsResolverPort,
  WebhookProvisioningRegistryService,
  WEBHOOK_PROVISIONING_REGISTRY_TOKEN,
  ConnectionConfigShapeValidatorRegistryService,
  CONNECTION_CONFIG_SHAPE_VALIDATOR_REGISTRY_TOKEN,
  ConnectionCredentialsShapeValidatorRegistryService,
  CONNECTION_CREDENTIALS_SHAPE_VALIDATOR_REGISTRY_TOKEN,
  ConnectionCredentialsRewriterRegistryService,
  CONNECTION_CREDENTIALS_REWRITER_REGISTRY_TOKEN,
  InvalidConnectionConfigException,
  InvalidCredentialsShapeException,
  ConnectionCredentialsRewriteException,
} from '@openlinker/core/integrations';
import type { SyncJobRequest } from '@openlinker/core/sync';
import { JobEnqueuePort, JOB_ENQUEUE_TOKEN } from '@openlinker/core/sync';
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
    @Inject(CREDENTIALS_SERVICE_TOKEN)
    private readonly credentials: ICredentialsService,
    @Inject(CONNECTION_TESTER_REGISTRY_TOKEN)
    private readonly connectionTesterRegistry: ConnectionTesterRegistryService,
    @Inject(WEBHOOK_PROVISIONING_REGISTRY_TOKEN)
    private readonly webhookProvisioningRegistry: WebhookProvisioningRegistryService,
    @Inject(CONNECTION_CONFIG_SHAPE_VALIDATOR_REGISTRY_TOKEN)
    private readonly connectionConfigShapeValidatorRegistry: ConnectionConfigShapeValidatorRegistryService,
    @Inject(CONNECTION_CREDENTIALS_SHAPE_VALIDATOR_REGISTRY_TOKEN)
    private readonly connectionCredentialsShapeValidatorRegistry: ConnectionCredentialsShapeValidatorRegistryService,
    @Inject(CONNECTION_CREDENTIALS_REWRITER_REGISTRY_TOKEN)
    private readonly connectionCredentialsRewriterRegistry: ConnectionCredentialsRewriterRegistryService,
    @Inject(CREDENTIALS_RESOLVER_TOKEN)
    private readonly credentialsResolver: CredentialsResolverPort
  ) {}

  /**
   * Run the plugin's config / credentials shape validators if registered.
   * The registries are keyed by adapterKey; the domain exception payload
   * is re-thrown as `BadRequestException` so the HTTP layer surfaces a
   * 400 with the flattened error list. Plugin packages don't depend on
   * `@nestjs/common` for the failure path (#586 / #587).
   */
  private async validateConfigShape(
    adapterKey: string,
    config: Record<string, unknown>
  ): Promise<void> {
    const validator = this.connectionConfigShapeValidatorRegistry.get(adapterKey);
    if (!validator) return;
    try {
      await validator.validate(config);
    } catch (error) {
      if (error instanceof InvalidConnectionConfigException) {
        throw new BadRequestException({
          message: error.message,
          errors: error.errors,
        });
      }
      throw error;
    }
  }

  private async validateCredentialsShape(
    adapterKey: string,
    credentials: Record<string, unknown>
  ): Promise<void> {
    const validator = this.connectionCredentialsShapeValidatorRegistry.get(adapterKey);
    if (!validator) return;
    try {
      await validator.validate(credentials);
    } catch (error) {
      if (error instanceof InvalidCredentialsShapeException) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  /**
   * Run the plugin's credentials rewriter if one is registered for this
   * adapterKey (#1387, ADR-031). A rewriter transforms the raw credentials
   * payload BEFORE it is merged onto the existing stored blob and shape-
   * validated — e.g. Erli resolves `reuseAllegroConnectionId` into a concrete
   * `allegroClientId`/`allegroClientSecret` pair fetched server-side, so the
   * raw Allegro `clientSecret` never round-trips through this HTTP layer.
   * This service has zero platform-specific knowledge of what a rewriter
   * does — it's a no-op passthrough when nothing is registered.
   */
  private async rewriteCredentials(
    adapterKey: string,
    credentials: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const rewriter = this.connectionCredentialsRewriterRegistry.get(adapterKey);
    if (!rewriter) return credentials;
    try {
      return await rewriter.rewrite(credentials);
    } catch (error) {
      if (error instanceof ConnectionCredentialsRewriteException) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  async installWebhooks(
    connectionId: string,
    actorUserId?: string
  ): Promise<WebhookProvisioningResult> {
    // Resolve the connection's adapter and look up the matching webhook
    // provisioner. Routing by adapterKey (mirrors `testConnection`) keeps the
    // controller framework-pure and lets `apps/api` boot without
    // PrestaShop-specific bindings (#583).
    const connection = await this.get(connectionId);
    const metadata = await this.integrationsService.resolveAdapterMetadata({
      platformType: connection.platformType,
      adapterKey: connection.adapterKey,
    });
    const provisioner = this.webhookProvisioningRegistry.get(metadata.adapterKey);
    if (!provisioner) {
      throw new BadRequestException(
        `Webhook auto-provisioning is not supported for adapter ${metadata.adapterKey}`
      );
    }
    this.logger.log(
      `Installing webhooks on connection ${connectionId} (adapter: ${metadata.adapterKey})`
    );
    return provisioner.install(connectionId, actorUserId);
  }

  async testConnection(connectionId: string): Promise<ConnectionTestResult> {
    // Disabled connections are intentionally still testable: operators use the
    // probe to diagnose *why* a connection was disabled (expired credentials,
    // unreachable host, etc). The FE gates the button on status separately.
    const connection = await this.get(connectionId);
    const metadata = await this.integrationsService.resolveAdapterMetadata({
      platformType: connection.platformType,
      adapterKey: connection.adapterKey,
    });
    const tester = this.connectionTesterRegistry.get(metadata.adapterKey);
    if (!tester) {
      throw new BadRequestException(
        `Connection testing is not supported for adapter ${metadata.adapterKey}`
      );
    }
    this.logger.log(`Testing connection ${connectionId} (adapter: ${metadata.adapterKey})`);
    const result = await tester.test(connection, this.credentialsResolver);
    this.logger.log(
      `Connection test ${result.success ? 'succeeded' : 'failed'} for ${connectionId} in ${result.latencyMs}ms` +
        (result.status !== undefined ? ` (status=${result.status})` : '')
    );
    return result;
  }

  async create(payload: ConnectionCreateInput): Promise<Connection> {
    const { credentials, credentialsRef, ...rest } = payload;

    if ((credentials && credentialsRef) || (!credentials && !credentialsRef)) {
      throw new BadRequestException(
        'Exactly one of `credentials` or `credentialsRef` must be provided'
      );
    }
    if (credentialsRef && !credentialsRef.startsWith('db:')) {
      throw new BadRequestException(
        'credentialsRef must start with "db:" — raw keys are no longer accepted'
      );
    }

    try {
      this.logger.log(`Creating connection: ${rest.name} (platform: ${rest.platformType})`);

      const metadata = await this.integrationsService.resolveAdapterMetadata({
        platformType: rest.platformType,
        adapterKey: rest.adapterKey,
      });

      const enabledCapabilities = rest.enabledCapabilities ?? [...metadata.supportedCapabilities];

      const invalid = enabledCapabilities.filter(
        (c) => !metadata.supportedCapabilities.includes(c)
      );
      if (invalid.length > 0) {
        throw new BadRequestException(
          `Capabilities not supported by adapter ${metadata.adapterKey}: ${invalid.join(', ')}`
        );
      }

      // #509 / #587 — validate the platform-specific config shape on create
      // (was platformType-keyed static record; now adapterKey-keyed registry
      // populated by each plugin's `register(host)`). Runs *before*
      // credentials are persisted so a 400 from validation doesn't leave an
      // orphan credential row. Absence of a registered validator is a
      // deliberate skip — plugins with no fixed shape don't register one.
      if (rest.config !== undefined) {
        await this.validateConfigShape(metadata.adapterKey, rest.config);
      }

      // Persist credentials if the caller supplied raw values. We write the
      // credential row *before* the connection row so the connection is never
      // persisted pointing at a missing credential. If connection creation
      // fails afterwards we best-effort delete the credential to avoid leaks.
      let resolvedCredentialsRef = credentialsRef;
      let createdCredentialRef: string | null = null;
      if (credentials) {
        const resolvedCredentials = await this.rewriteCredentials(metadata.adapterKey, credentials);
        await this.validateCredentialsShape(metadata.adapterKey, resolvedCredentials);
        const ref = randomUUID();
        await this.credentials.create({
          ref,
          platformType: rest.platformType,
          credentialsJson: resolvedCredentials,
        });
        createdCredentialRef = ref;
        resolvedCredentialsRef = `db:${ref}`;
        this.logger.log(
          `Persisted credentials for new ${rest.platformType} connection (ref: db:${ref})`
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
            await this.credentials.delete(createdCredentialRef);
            this.logger.warn(
              `Rolled back orphaned credential ${createdCredentialRef} after connection create failure`
            );
          } catch (cleanupError) {
            this.logger.error(
              `Failed to roll back orphaned credential ${createdCredentialRef}: ${(cleanupError as Error).message}`
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
        `Bootstrap catalog sync ${isExisting ? 'already enqueued' : 'enqueued'} for connection ${connection.id}: ${jobId}`
      );
    } catch (error) {
      this.logger.warn(
        `Bootstrap catalog sync skipped for connection ${connection.id}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async list(filters?: ConnectionFilters): Promise<Connection[]> {
    try {
      this.logger.debug(
        `Listing connections${filters ? ` with filters: ${JSON.stringify(filters)}` : ''}`
      );
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
      this.logger.debug(
        `Connection retrieved: ${connection.id} (${connection.name}, status: ${connection.status})`
      );
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

  async update(connectionId: string, patch: ConnectionUpdate): Promise<Connection> {
    try {
      this.logger.log(
        `Updating connection: ${connectionId}${patch.status ? ` (status: ${patch.status})` : ''}`
      );

      const existing = await this.connectionPort.get(connectionId);

      if (patch.adapterKey !== undefined && patch.adapterKey !== existing.adapterKey) {
        throw new BadRequestException(
          `adapterKey is immutable after connection creation (current: ${existing.adapterKey ?? 'derived from platformType'})`
        );
      }

      // Resolve adapter metadata once for both validation branches below.
      // The capability-check and the #437 / #587 config-shape-validation
      // branch both need the connection's adapterKey; resolving once keeps
      // them in lockstep and avoids a duplicate registry lookup when a patch
      // carries both fields. We only resolve when at least one branch will
      // consume the result, so a name-only patch (`patch = { name }`) stays
      // free of an extra call.
      const needsAdapterMetadata =
        patch.enabledCapabilities !== undefined || patch.config !== undefined;
      const metadata = needsAdapterMetadata
        ? await this.integrationsService.resolveAdapterMetadata({
            platformType: existing.platformType,
            adapterKey: existing.adapterKey,
          })
        : null;

      if (patch.enabledCapabilities !== undefined && metadata) {
        const invalid = patch.enabledCapabilities.filter(
          (c) => !metadata.supportedCapabilities.includes(c)
        );
        if (invalid.length > 0) {
          throw new BadRequestException(
            `Capabilities not supported by adapter ${metadata.adapterKey}: ${invalid.join(', ')}`
          );
        }
      }

      // #437 / #587 — close the DTO bypass on `Connection.config`. The
      // HTTP-layer `UpdateConnectionDto.config: Record<string, unknown>`
      // erases the typed shape at the controller boundary, so the nested
      // platform-specific decorators never run. Re-validate via the
      // adapterKey-keyed registry before persistence. `existing.adapterKey`
      // may be undefined when the connection was created without an explicit
      // override, so the resolved adapterKey above falls back to the
      // platform default via `resolveAdapterMetadata`.
      if (patch.config !== undefined && metadata) {
        await this.validateConfigShape(metadata.adapterKey, patch.config);
      }

      const connection = await this.connectionPort.update(connectionId, patch);
      this.logger.log(
        `Connection updated successfully: ${connection.id} (status: ${connection.status})`
      );
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
    credentials: Record<string, unknown>
  ): Promise<void> {
    const connection = await this.get(connectionId);
    if (!connection.credentialsRef.startsWith('db:')) {
      throw new BadRequestException(
        `Connection ${connectionId} does not have a db-backed credentials reference ` +
          `(current: ${connection.credentialsRef}); in-place credential rotation is not supported`
      );
    }
    const metadata = await this.integrationsService.resolveAdapterMetadata({
      platformType: connection.platformType,
      adapterKey: connection.adapterKey,
    });
    const resolvedCredentials = await this.rewriteCredentials(metadata.adapterKey, credentials);
    const ref = connection.credentialsRef.slice('db:'.length);
    // Merge onto the existing stored credentials rather than replacing the
    // whole blob: callers only send the fields they actually changed (e.g.
    // rotating just `apiKey`), and a full replace would silently delete any
    // other previously-stored field (e.g. Erli's optional Allegro
    // `allegroClientId`/`allegroClientSecret` pair, #1401 review).
    const existing = await this.credentials.getByRef(ref);
    const mergedCredentials = { ...existing.credentialsJson, ...resolvedCredentials };
    await this.validateCredentialsShape(metadata.adapterKey, mergedCredentials);
    await this.credentials.update(ref, { credentialsJson: mergedCredentials });
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
