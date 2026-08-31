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
  resolveRequiresCredentials,
} from '@openlinker/core/integrations';
import type { SyncJobRequest } from '@openlinker/core/sync';
import { JobEnqueuePort, JOB_ENQUEUE_TOKEN } from '@openlinker/core/sync';
import { IDestinationTaxonomyService } from '@openlinker/core/listings';
import { DESTINATION_TAXONOMY_SERVICE_TOKEN } from '@openlinker/core/listings';
import { Inject } from '@nestjs/common';
import { Logger } from '@openlinker/shared/logging';
import { HTTP_TRANSPORT_FACTORY_TOKEN } from '@openlinker/plugin-sdk';
// Non-type-only import: HttpTransportFactoryPort is the type of a
// constructor parameter on an @Injectable() class, and
// `emitDecoratorMetadata` requires a non-erased reference (mirrors the
// RateLimitStatusService convention).
import { HttpTransportFactoryPort } from '@openlinker/shared/http';

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
    private readonly credentialsResolver: CredentialsResolverPort,
    @Inject(HTTP_TRANSPORT_FACTORY_TOKEN)
    private readonly httpTransportFactory: HttpTransportFactoryPort,
    @Inject(DESTINATION_TAXONOMY_SERVICE_TOKEN)
    private readonly destinationTaxonomy: IDestinationTaxonomyService
  ) {}

  /**
   * Advisory authority guard (#1498): a connection must not have both
   * `InventoryMaster` and `OfferManager` enabled — the inventory master is
   * the source of truth for stock, so it must never also be a stock
   * write-back target (the write would echo the master back at itself,
   * last-write-wins). This connection-management check is advisory; the
   * authoritative runtime guard is `IntegrationsService.getCapabilityAdapter`
   * throwing `CapabilityNotEnabledException` at execution time. A capability
   * flip between a job's enqueue and its run (the fan-out's own eligibility
   * check runs at enqueue time, not execution time) therefore fails that job
   * cleanly instead of writing back to the master.
   */
  private assertNoWriteBackAuthorityConflict(enabledCapabilities: string[]): void {
    if (
      enabledCapabilities.includes('InventoryMaster') &&
      enabledCapabilities.includes('OfferManager')
    ) {
      throw new BadRequestException(
        'InventoryMaster and OfferManager cannot both be enabled on the same connection: ' +
          'the inventory master is the stock source of truth and must not be a stock ' +
          'write-back target. Disable InventoryMaster before enabling OfferManager (or vice versa).'
      );
    }
  }

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

  /**
   * Core-owned bounds check for `config.rateLimit` (#1810). Neutral —
   * every adapter shares this validation, so no per-plugin config-shape
   * validator needs to know about it. Never defaults a value into the
   * stored config; an absent `rateLimit` (or an absent knob within it)
   * stays absent.
   */
  private validateRateLimitConfig(config: Record<string, unknown>): void {
    const rateLimit = config.rateLimit;
    if (rateLimit === undefined || rateLimit === null) return;
    if (typeof rateLimit !== 'object' || Array.isArray(rateLimit)) {
      throw new BadRequestException('config.rateLimit must be an object');
    }

    const { requestsPerMinute, maxConcurrent } = rateLimit as Record<string, unknown>;
    if (
      requestsPerMinute !== undefined &&
      (typeof requestsPerMinute !== 'number' || requestsPerMinute < 1 || requestsPerMinute > 6000)
    ) {
      throw new BadRequestException(
        'config.rateLimit.requestsPerMinute must be a number between 1 and 6000'
      );
    }
    if (
      maxConcurrent !== undefined &&
      (typeof maxConcurrent !== 'number' || maxConcurrent < 1 || maxConcurrent > 64)
    ) {
      throw new BadRequestException(
        'config.rateLimit.maxConcurrent must be a number between 1 and 64'
      );
    }
  }

  /**
   * Core-owned bounds check for the three platform-neutral stock and pricing
   * keys (#2610): `config.stockSafetyBuffer`, `config.stockZeroThreshold` and
   * `config.pricingRule`. Neutral, like `validateRateLimitConfig` - every
   * adapter shares it, so no per-plugin config-shape validator knows about it.
   *
   * The connection form refuses a bad value already, but the form is not the
   * only way in: the raw JSON editor sits on the same page and bypasses the
   * form's own rules, and curl and MCP bypass the browser entirely. The
   * margin bound matters most - core degrades a margin of 100% or more back to
   * the catalogue price, so without this the operator saves happily and then
   * quietly publishes an unchanged price.
   *
   * Never defaults a value in; an absent key stays absent.
   */
  private validateStockAndPricingConfig(config: Record<string, unknown>): void {
    for (const key of ['stockSafetyBuffer', 'stockZeroThreshold'] as const) {
      const value = config[key];
      if (value === undefined || value === null) continue;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new BadRequestException(`config.${key} must be a number of 0 or more`);
      }
    }

    const pricingRule = config.pricingRule;
    if (pricingRule === undefined || pricingRule === null) return;
    if (typeof pricingRule !== 'object' || Array.isArray(pricingRule)) {
      throw new BadRequestException('config.pricingRule must be an object');
    }

    const { type, percent, rounding } = pricingRule as Record<string, unknown>;
    const types = ['passthrough', 'markup', 'margin'];
    if (type !== undefined && (typeof type !== 'string' || !types.includes(type))) {
      throw new BadRequestException(
        `config.pricingRule.type must be one of ${types.join(', ')}`
      );
    }
    const roundings = ['none', 'nearestWhole', 'endingIn99'];
    if (
      rounding !== undefined &&
      (typeof rounding !== 'string' || !roundings.includes(rounding))
    ) {
      throw new BadRequestException(
        `config.pricingRule.rounding must be one of ${roundings.join(', ')}`
      );
    }
    if (percent !== undefined && percent !== null) {
      if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0) {
        throw new BadRequestException('config.pricingRule.percent must be a number of 0 or more');
      }
      if (type === 'margin' && percent >= 100) {
        throw new BadRequestException(
          'config.pricingRule.percent must be below 100 for a margin rule. To add more than ' +
            'the catalogue price, use a markup instead.'
        );
      }
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

    // Supplying BOTH is contradictory input at every setting, including for a
    // credential-less adapter (#2405): the `if (credentials)` branch below
    // would win, encrypting and persisting a credential row nothing ever reads
    // while silently discarding the caller's own ref, reporting
    // `credentialsBacked: true`, and handing `updateCredentials` its
    // db-backed branch. So this stays unconditional and stays here, above the
    // adapter lookup — it needs no manifest to be wrong.
    if (credentials && credentialsRef) {
      throw new BadRequestException(
        'Exactly one of `credentials` or `credentialsRef` must be provided'
      );
    }
    // Likewise unconditional: a raw key written into the column reads as
    // "not db-backed" to `connection-response.dto.ts` and `updateCredentials`,
    // yet is TRUTHY to every plugin factory's `if (connection.credentialsRef)`
    // guard, which would then resolve it from the environment.
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

      // The "neither supplied" arm is the ONLY one an adapter may relax, and
      // it can only be decided once the manifest is known — hence its position
      // below the lookup rather than beside its two siblings above (#2405,
      // ADR-055). An adapter declaring nothing keeps the guard it always had:
      // `resolveRequiresCredentials` defaults to `true`.
      //
      // Capability-wise, never `platformType === 'openlinker'`: a privileged
      // check by name would be unavailable to any third-party OMS adapter,
      // which is precisely the design ADR-055 rejects.
      if (resolveRequiresCredentials(metadata) && !credentials && !credentialsRef) {
        throw new BadRequestException(
          'Exactly one of `credentials` or `credentialsRef` must be provided'
        );
      }

      // Stock write-back defaults OFF for inventory-master-capable shops
      // (#1498): when the caller omits enabledCapabilities, exclude
      // OfferManager from the manifest-derived default whenever the manifest
      // also declares InventoryMaster. An inventory master must opt in to
      // being a write-back target (and doing so requires disabling
      // InventoryMaster first — see the mutual-exclusion guard below), which
      // preserves the "publish-only unless the operator asks" posture.
      // Marketplace manifests (no InventoryMaster) keep the full default set.
      const defaultCapabilities = metadata.supportedCapabilities.includes('InventoryMaster')
        ? metadata.supportedCapabilities.filter((c) => c !== 'OfferManager')
        : [...metadata.supportedCapabilities];
      const enabledCapabilities = rest.enabledCapabilities ?? defaultCapabilities;

      const invalid = enabledCapabilities.filter(
        (c) => !metadata.supportedCapabilities.includes(c)
      );
      if (invalid.length > 0) {
        throw new BadRequestException(
          `Capabilities not supported by adapter ${metadata.adapterKey}: ${invalid.join(', ')}`
        );
      }
      this.assertNoWriteBackAuthorityConflict(enabledCapabilities);

      // #509 / #587 — validate the platform-specific config shape on create
      // (was platformType-keyed static record; now adapterKey-keyed registry
      // populated by each plugin's `register(host)`). Runs *before*
      // credentials are persisted so a 400 from validation doesn't leave an
      // orphan credential row. Absence of a registered validator is a
      // deliberate skip — plugins with no fixed shape don't register one.
      if (rest.config !== undefined) {
        this.validateRateLimitConfig(rest.config);
        this.validateStockAndPricingConfig(rest.config);
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
          // `''`, never `undefined`: the column is `character varying NOT
          // NULL`, and a credential-less adapter legitimately reaches here
          // with nothing resolved (#2405). `''` is the shipped Subiekt
          // precedent — falsy exactly where `null` is, and safe at the two
          // unguarded `.startsWith('db:')` sites where `null` would throw
          // (`connection-response.dto.ts`, per row on every list render, and
          // `updateCredentials`).
          credentialsRef: resolvedCredentialsRef ?? '',
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
      await this.enqueueInitialTaxonomySync(connection);
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

  /**
   * Best-effort initial destination-taxonomy bootstrap (#2084).
   *
   * The category pickers read the `DestinationCategory` projection rather than
   * the live platform (ADR-037), and the only writer is an hourly scheduler
   * task — so without this a connection created at :24 shows an empty category
   * picker until :23 the next hour. That gap is what blocked #2085 from
   * delegating the shop-side read to the projection.
   *
   * Two triggers, both routed here: unconditionally at create, and on the
   * transition into `active`. Create is deliberately NOT gated on status —
   * `resolveScope` cannot resolve an adapter for a disabled connection and so
   * skips on its own, and encoding that rule twice gives it two places to drift
   * (mirrors `enqueueInitialCatalogSync`, which is also unconditional).
   *
   * Note what this does and does not promise: the sync handler runs one page
   * per job and does not self-reschedule, so this makes the walk START
   * immediately rather than up to an hour later. A shop tree is small enough to
   * finish in that first run; a marketplace tree still spans several ticks.
   *
   * Failures MUST NOT fail the connection write — the connection is genuinely
   * created/enabled even if the enqueue fails, and the hourly task is the
   * backstop.
   */
  private async enqueueInitialTaxonomySync(connection: Connection): Promise<void> {
    try {
      // Throws TaxonomySourceUnavailableException when the connection exposes
      // no taxonomy source, which doubles as the capability gate: nothing to
      // browse => nothing to bootstrap.
      const scope = await this.destinationTaxonomy.resolveScope(connection.id);

      // AC-4: a second marketplace connection joins an owner-keyed scope that
      // is already populated, and the per-scope lock only prevents a
      // CONCURRENT walk — an owner synced an hour ago has a free lock and would
      // be fully re-walked (thousands of platform calls). A synced scope always
      // has roots, so a non-empty root level is a sound "already bootstrapped".
      // A shop scope is connection-keyed and therefore always empty here.
      const roots = await this.destinationTaxonomy.browse(connection.id);
      if (roots.length > 0) {
        this.logger.debug(
          `Taxonomy bootstrap skipped for connection ${connection.id}: scope already populated (${roots.length} root categories)`
        );
        return;
      }

      const jobRequest: SyncJobRequest = {
        jobType: 'destination.taxonomy.sync',
        connectionId: connection.id,
        payload: { schemaVersion: 1, taxonomyOwner: scope.taxonomyOwner },
        // Run-once per connection, unlike the scheduler's per-tick timestamped
        // key. A re-enable after a disable therefore collapses into this key
        // and enqueues nothing — correct, because `disable()` does not delete
        // projection rows, so a re-enabled connection still has its tree.
        idempotencyKey: `bootstrap:${connection.id}:taxonomy:sync`,
      };

      const { jobId, isExisting } = await this.jobEnqueue.enqueueJob(jobRequest);
      this.logger.log(
        `Bootstrap taxonomy sync ${isExisting ? 'already enqueued' : 'enqueued'} for connection ${connection.id}: ${jobId}`
      );
    } catch (error) {
      this.logger.warn(
        `Bootstrap taxonomy sync skipped for connection ${connection.id}: ${error instanceof Error ? error.message : String(error)}`
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
        this.assertNoWriteBackAuthorityConflict(patch.enabledCapabilities);
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
        this.validateRateLimitConfig(patch.config);
        this.validateStockAndPricingConfig(patch.config);
        await this.validateConfigShape(metadata.adapterKey, patch.config);
      }

      const connection = await this.connectionPort.update(connectionId, patch);
      this.logger.log(
        `Connection updated successfully: ${connection.id} (status: ${connection.status})`
      );

      // #2084 — a connection created disabled skips the create-time bootstrap
      // (its adapter cannot resolve), so enabling it is the moment its taxonomy
      // first becomes fetchable. Tested against the PERSISTED status, not
      // `patch.status`: a patch omitting status must not read as a transition.
      if (existing.status !== 'active' && connection.status === 'active') {
        await this.enqueueInitialTaxonomySync(connection);
      }

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
      // A disabled connection sends no more outbound traffic — drop its
      // rate-limiter/transport-cache state instead of leaking it for the
      // rest of the process lifetime. Re-enabling lazily rebuilds it (idle
      // state, no carried queue) on the next call.
      this.httpTransportFactory.evict(connectionId);
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
