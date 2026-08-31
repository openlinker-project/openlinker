/**
 * Connection Service Unit Tests
 *
 * Unit tests for ConnectionService, verifying API layer service
 * wrapper functionality and error handling.
 *
 * @module apps/api/src/integrations/application/services
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { PricingRule } from '@openlinker/core/identifier-mapping';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConnectionService } from './connection.service';
import type {
  ConnectionPort,
  ConnectionUpdate,
  ConnectionFilters,
  ConnectionRateLimit,
} from '@openlinker/core/identifier-mapping';
import {
  CONNECTION_PORT_TOKEN,
  Connection,
  ConnectionNotFoundException,
} from '@openlinker/core/identifier-mapping';
import type {
  IIntegrationsService,
  ICredentialsService,
  CredentialsResolverPort,
  ConnectionTesterPort,
  WebhookProvisioningPort,
} from '@openlinker/core/integrations';
import {
  INTEGRATIONS_SERVICE_TOKEN,
  CREDENTIALS_SERVICE_TOKEN,
  ConnectionTesterRegistryService,
  CONNECTION_TESTER_REGISTRY_TOKEN,
  CREDENTIALS_RESOLVER_TOKEN,
  WebhookProvisioningRegistryService,
  WEBHOOK_PROVISIONING_REGISTRY_TOKEN,
  ConnectionConfigShapeValidatorRegistryService,
  CONNECTION_CONFIG_SHAPE_VALIDATOR_REGISTRY_TOKEN,
  ConnectionCredentialsShapeValidatorRegistryService,
  CONNECTION_CREDENTIALS_SHAPE_VALIDATOR_REGISTRY_TOKEN,
  ConnectionCredentialsRewriterRegistryService,
  CONNECTION_CREDENTIALS_REWRITER_REGISTRY_TOKEN,
  ConnectionCredentialsRewriteException,
} from '@openlinker/core/integrations';
import type { ConnectionCredentialsRewriterPort } from '@openlinker/core/integrations';
import { HTTP_TRANSPORT_FACTORY_TOKEN } from '@openlinker/plugin-sdk';
import type { HttpTransportFactoryPort } from '@openlinker/shared/http';
import { AllegroConnectionConfigShapeValidatorAdapter } from '@openlinker/integrations-allegro';
import {
  PrestashopConnectionConfigShapeValidatorAdapter,
  PrestashopConnectionCredentialsShapeValidatorAdapter,
} from '@openlinker/integrations-prestashop';
import type { JobEnqueuePort } from '@openlinker/core/sync';
import { JOB_ENQUEUE_TOKEN } from '@openlinker/core/sync';
import { DESTINATION_TAXONOMY_SERVICE_TOKEN } from '@openlinker/core/listings';
import type { IDestinationTaxonomyService } from '@openlinker/core/listings';
import type { ConnectionCreateInput } from '../interfaces/connection.service.types';

describe('ConnectionService', () => {
  let service: ConnectionService;
  let connectionPort: jest.Mocked<ConnectionPort>;
  let integrationsService: jest.Mocked<IIntegrationsService>;
  let jobEnqueue: jest.Mocked<JobEnqueuePort>;
  let destinationTaxonomy: jest.Mocked<IDestinationTaxonomyService>;
  let credentials: jest.Mocked<ICredentialsService>;
  let testerRegistry: ConnectionTesterRegistryService;
  let mockTester: jest.Mocked<ConnectionTesterPort>;
  let webhookProvisioningRegistry: WebhookProvisioningRegistryService;
  let mockWebhookProvisioner: jest.Mocked<WebhookProvisioningPort>;
  let configValidatorRegistry: ConnectionConfigShapeValidatorRegistryService;
  let credentialsValidatorRegistry: ConnectionCredentialsShapeValidatorRegistryService;
  let credentialsRewriterRegistry: ConnectionCredentialsRewriterRegistryService;
  let mockHttpTransportFactory: jest.Mocked<HttpTransportFactoryPort>;

  const mockConnection = new Connection(
    'connection-123',
    'prestashop',
    'Test Connection',
    'active',
    { baseUrl: 'https://example.com' },
    'cred_123',
    new Date(),
    new Date(),

    undefined,
    ['ProductMaster', 'InventoryMaster', 'OrderSource', 'OrderProcessorManager', 'OfferManager']
  );

  beforeEach(async () => {
    const mockConnectionPort = {
      get: jest.fn(),
      list: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      disable: jest.fn(),
    } as unknown as jest.Mocked<ConnectionPort>;

    const mockIntegrationsService = {
      getAdapter: jest.fn().mockResolvedValue({
        connection: mockConnection,
        adapter: {},
        metadata: { supportedCapabilities: [] },
      }),
      getCapabilityAdapter: jest.fn(),
      listCapabilityAdapters: jest.fn(),
      resolveAdapterMetadata: jest.fn().mockResolvedValue({
        adapterKey: 'prestashop.webservice.v1',
        platformType: 'prestashop',
        supportedCapabilities: [
          'ProductMaster',
          'InventoryMaster',
          'OrderSource',
          'OrderProcessorManager',
        ],
      }),
    } as unknown as jest.Mocked<IIntegrationsService>;

    const mockJobEnqueue = {
      enqueueJob: jest.fn().mockResolvedValue({ jobId: 'job-1', isExisting: false }),
    } as unknown as jest.Mocked<JobEnqueuePort>;

    // #2084 — defaults to "this connection has no taxonomy source", so every
    // pre-existing test keeps its original single-enqueue expectations and only
    // the taxonomy-bootstrap tests opt in.
    const mockDestinationTaxonomy = {
      resolveScope: jest.fn().mockRejectedValue(new Error('TaxonomySourceUnavailableException')),
      browse: jest.fn().mockResolvedValue([]),
      search: jest.fn(),
      syncTaxonomy: jest.fn(),
      path: jest.fn(),
    } as unknown as jest.Mocked<IDestinationTaxonomyService>;

    const mockCredentials = {
      create: jest
        .fn()
        .mockImplementation(
          (payload: {
            ref: string;
            platformType: string;
            credentialsJson: Record<string, unknown>;
          }) =>
            Promise.resolve({
              id: 'cred-row-1',
              ref: payload.ref,
              platformType: payload.platformType,
              credentialsJson: payload.credentialsJson,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
        ),
      update: jest.fn(),
      getByRef: jest.fn().mockResolvedValue({
        id: 'cred-row-1',
        ref: 'cred-ref-1',
        platformType: 'prestashop',
        credentialsJson: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      delete: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<ICredentialsService>;

    testerRegistry = new ConnectionTesterRegistryService();
    mockTester = { test: jest.fn() } as jest.Mocked<ConnectionTesterPort>;
    testerRegistry.register('prestashop.webservice.v1', mockTester);

    webhookProvisioningRegistry = new WebhookProvisioningRegistryService();
    mockWebhookProvisioner = { install: jest.fn() } as jest.Mocked<WebhookProvisioningPort>;
    webhookProvisioningRegistry.register('prestashop.webservice.v1', mockWebhookProvisioner);

    // Shape-validator registries (#586 / #587). Register the REAL plugin
    // adapters so the spec keeps testing the actual DTO shape rules
    // (pre-#587 the same coverage lived inside ConnectionService against the
    // hard-coded `CONNECTION_CONFIG_VALIDATORS` Record). The unit-level
    // boundaries are intact: the registry seam is mocked-friendly (a per-test
    // `validatorOverride = { validate: jest.fn() }` can replace the real
    // validator), but the default config keeps the same end-to-end
    // create/update validation contract these tests pin.
    configValidatorRegistry = new ConnectionConfigShapeValidatorRegistryService();
    configValidatorRegistry.register(
      'prestashop.webservice.v1',
      new PrestashopConnectionConfigShapeValidatorAdapter()
    );
    configValidatorRegistry.register(
      'allegro.publicapi.v1',
      new AllegroConnectionConfigShapeValidatorAdapter()
    );

    credentialsValidatorRegistry = new ConnectionCredentialsShapeValidatorRegistryService();
    credentialsValidatorRegistry.register(
      'prestashop.webservice.v1',
      new PrestashopConnectionCredentialsShapeValidatorAdapter()
    );

    // Credentials-rewriter registry (#1387, ADR-031). Empty by default so
    // `updateCredentials` exercises the no-op passthrough for every existing
    // test; individual tests register a stub rewriter to exercise the
    // delegation path.
    credentialsRewriterRegistry = new ConnectionCredentialsRewriterRegistryService();

    const mockCredentialsResolver: CredentialsResolverPort = {
      get: jest.fn(),
    } as unknown as CredentialsResolverPort;

    mockHttpTransportFactory = {
      forConnection: jest.fn(),
      evict: jest.fn(),
    } as jest.Mocked<HttpTransportFactoryPort>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectionService,
        { provide: CONNECTION_PORT_TOKEN, useValue: mockConnectionPort },
        { provide: INTEGRATIONS_SERVICE_TOKEN, useValue: mockIntegrationsService },
        { provide: JOB_ENQUEUE_TOKEN, useValue: mockJobEnqueue },
        { provide: DESTINATION_TAXONOMY_SERVICE_TOKEN, useValue: mockDestinationTaxonomy },
        { provide: CREDENTIALS_SERVICE_TOKEN, useValue: mockCredentials },
        { provide: CONNECTION_TESTER_REGISTRY_TOKEN, useValue: testerRegistry },
        { provide: WEBHOOK_PROVISIONING_REGISTRY_TOKEN, useValue: webhookProvisioningRegistry },
        {
          provide: CONNECTION_CONFIG_SHAPE_VALIDATOR_REGISTRY_TOKEN,
          useValue: configValidatorRegistry,
        },
        {
          provide: CONNECTION_CREDENTIALS_SHAPE_VALIDATOR_REGISTRY_TOKEN,
          useValue: credentialsValidatorRegistry,
        },
        {
          provide: CONNECTION_CREDENTIALS_REWRITER_REGISTRY_TOKEN,
          useValue: credentialsRewriterRegistry,
        },
        { provide: CREDENTIALS_RESOLVER_TOKEN, useValue: mockCredentialsResolver },
        { provide: HTTP_TRANSPORT_FACTORY_TOKEN, useValue: mockHttpTransportFactory },
      ],
    }).compile();

    service = module.get<ConnectionService>(ConnectionService);
    connectionPort = module.get(CONNECTION_PORT_TOKEN);
    integrationsService = module.get(INTEGRATIONS_SERVICE_TOKEN);
    jobEnqueue = module.get(JOB_ENQUEUE_TOKEN);
    destinationTaxonomy = module.get(DESTINATION_TAXONOMY_SERVICE_TOKEN);
    credentials = module.get(CREDENTIALS_SERVICE_TOKEN);
  });

  describe('create', () => {
    const payload: ConnectionCreateInput = {
      name: 'New Connection',
      platformType: 'prestashop',
      config: { baseUrl: 'https://new.com' },
      credentialsRef: 'db:existing-ref',
    };

    it('should create and return connection', async () => {
      connectionPort.create.mockResolvedValue(mockConnection);

      const result = await service.create(payload);

      expect(result).toEqual(mockConnection);
      expect(connectionPort.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ...payload,
          enabledCapabilities: expect.any(Array),
        })
      );
      expect(credentials.create).not.toHaveBeenCalled();
    });

    it('should reject raw-key credentialsRef without db: prefix', async () => {
      await expect(service.create({ ...payload, credentialsRef: 'RAW_KEY_XYZ' })).rejects.toThrow(
        /must start with "db:"/
      );
      expect(connectionPort.create).not.toHaveBeenCalled();
    });

    it('should reject when both credentials and credentialsRef are provided', async () => {
      await expect(
        service.create({
          ...payload,
          credentials: { webserviceApiKey: 'X' },
        })
      ).rejects.toThrow(/Exactly one of/);
    });

    it('should reject when neither is provided and the adapter REQUIRES credentials', async () => {
      // The default mock declares no `requiresCredentials`, so
      // `resolveRequiresCredentials` resolves the safe default `true` and the
      // guard is unchanged for every shipped adapter (#2405).
      const rest: ConnectionCreateInput = { ...payload };
      delete rest.credentialsRef;
      await expect(service.create(rest)).rejects.toThrow(/Exactly one of/);
    });

    describe('credential-less adapter (requiresCredentials: false, #2405 / ADR-055)', () => {
      const credentialLessMetadata = {
        adapterKey: 'openlinker.oms.v1',
        platformType: 'openlinker',
        supportedCapabilities: [],
        isDefault: true,
        requiresCredentials: false,
      };

      it('should ACCEPT a create with neither credentials nor credentialsRef', async () => {
        integrationsService.resolveAdapterMetadata.mockResolvedValueOnce(
          credentialLessMetadata as never
        );
        connectionPort.create.mockResolvedValue(mockConnection);

        const rest: ConnectionCreateInput = { ...payload, platformType: 'openlinker' };
        delete rest.credentialsRef;

        await expect(service.create(rest)).resolves.toEqual(mockConnection);
        expect(credentials.create).not.toHaveBeenCalled();
      });

      it('should persist an EMPTY STRING credentialsRef, never undefined', async () => {
        // The column is `character varying NOT NULL`, and `''` is the shipped
        // Subiekt precedent: falsy exactly where `null` is, and safe at the two
        // unguarded `.startsWith('db:')` sites where `null` would throw.
        integrationsService.resolveAdapterMetadata.mockResolvedValueOnce(
          credentialLessMetadata as never
        );
        connectionPort.create.mockResolvedValue(mockConnection);

        const rest: ConnectionCreateInput = { ...payload, platformType: 'openlinker' };
        delete rest.credentialsRef;
        await service.create(rest);

        expect(connectionPort.create).toHaveBeenCalledWith(
          expect.objectContaining({ credentialsRef: '' })
        );
      });

      it('should STILL reject when BOTH credentials and credentialsRef are provided', async () => {
        // Relaxation applies to the "neither" arm only. "Both" is contradictory
        // input at every setting: letting it through would encrypt and persist
        // a credential row nothing ever reads, silently discard the caller's
        // own ref, and hand `updateCredentials` its db-backed branch.
        //
        // Deliberately NO metadata mock: this guard runs ABOVE the adapter
        // lookup, so the manifest is never consulted and queueing one would
        // suggest this case exercises the credential-less path when it cannot.
        await expect(
          service.create({
            ...payload,
            platformType: 'openlinker',
            credentials: { anything: 'X' },
          })
        ).rejects.toThrow(/Exactly one of/);
        expect(connectionPort.create).not.toHaveBeenCalled();
        expect(credentials.create).not.toHaveBeenCalled();
      });

      it('should STILL reject a raw-key credentialsRef', async () => {
        // Also pre-lookup, and for the same reason — see above.
        await expect(
          service.create({ ...payload, platformType: 'openlinker', credentialsRef: 'RAW_KEY_XYZ' })
        ).rejects.toThrow(/must start with "db:"/);
        expect(connectionPort.create).not.toHaveBeenCalled();
      });
    });

    it('should persist credentials and store db: ref when credentials payload is provided', async () => {
      connectionPort.create.mockResolvedValue(mockConnection);

      await service.create({
        name: 'Wizard Connection',
        platformType: 'prestashop',
        config: { baseUrl: 'https://new.com' },
        credentials: { webserviceApiKey: 'SECRET123' },
      });

      expect(credentials.create).toHaveBeenCalledWith(
        expect.objectContaining({
          platformType: 'prestashop',
          credentialsJson: { webserviceApiKey: 'SECRET123' },
          ref: expect.any(String),
        })
      );
      const credentialCall = credentials.create.mock.calls[0][0];
      expect(connectionPort.create).toHaveBeenCalledWith(
        expect.objectContaining({
          credentialsRef: `db:${credentialCall.ref}`,
        })
      );
    });

    it('should run the registered rewriter on the create path before persisting credentials (#1405 review)', async () => {
      connectionPort.create.mockResolvedValue(mockConnection);
      const stubRewriter: jest.Mocked<ConnectionCredentialsRewriterPort> = {
        rewrite: jest
          .fn()
          .mockResolvedValue({ webserviceApiKey: 'REWRITTEN', extraField: 'added-by-rewriter' }),
      };
      credentialsRewriterRegistry.register('prestashop.webservice.v1', stubRewriter);

      await service.create({
        name: 'Wizard Connection',
        platformType: 'prestashop',
        config: { baseUrl: 'https://new.com' },
        credentials: { webserviceApiKey: 'RAW' },
      });

      expect(stubRewriter.rewrite).toHaveBeenCalledWith({ webserviceApiKey: 'RAW' });
      expect(credentials.create).toHaveBeenCalledWith(
        expect.objectContaining({
          credentialsJson: { webserviceApiKey: 'REWRITTEN', extraField: 'added-by-rewriter' },
        })
      );
    });

    it('should map a ConnectionCredentialsRewriteException from the rewriter to BadRequestException on create (#1405 review)', async () => {
      const stubRewriter: jest.Mocked<ConnectionCredentialsRewriterPort> = {
        rewrite: jest
          .fn()
          .mockRejectedValue(
            new ConnectionCredentialsRewriteException('Stub', 'source connection is invalid')
          ),
      };
      credentialsRewriterRegistry.register('prestashop.webservice.v1', stubRewriter);

      await expect(
        service.create({
          name: 'Wizard Connection',
          platformType: 'prestashop',
          config: { baseUrl: 'https://new.com' },
          credentials: { webserviceApiKey: 'RAW' },
        })
      ).rejects.toThrow(BadRequestException);
      expect(credentials.create).not.toHaveBeenCalled();
    });

    it('should reject PrestaShop credentials missing webserviceApiKey', async () => {
      await expect(
        service.create({
          name: 'Wizard Connection',
          platformType: 'prestashop',
          config: { baseUrl: 'https://new.com' },
          credentials: { someOtherField: 'X' },
        })
      ).rejects.toThrow(/webserviceApiKey/);
      expect(credentials.create).not.toHaveBeenCalled();
    });

    it('should roll back the credential row if connection creation fails', async () => {
      connectionPort.create.mockRejectedValue(new Error('boom'));

      await expect(
        service.create({
          name: 'Wizard Connection',
          platformType: 'prestashop',
          config: { baseUrl: 'https://new.com' },
          credentials: { webserviceApiKey: 'SECRET123' },
        })
      ).rejects.toThrow(/boom/);

      expect(credentials.create).toHaveBeenCalledTimes(1);
      const createdRef = credentials.create.mock.calls[0][0].ref;
      expect(credentials.delete).toHaveBeenCalledWith(createdRef);
    });

    it('should enqueue master.product.syncAll when adapter supports ProductMaster', async () => {
      connectionPort.create.mockResolvedValue(mockConnection);
      integrationsService.getAdapter.mockResolvedValue({
        connection: mockConnection,
        adapter: {},
        metadata: { supportedCapabilities: ['ProductMaster', 'InventoryMaster'] },
      } as unknown as Awaited<ReturnType<IIntegrationsService['getAdapter']>>);

      await service.create(payload);

      expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
        expect.objectContaining({
          jobType: 'master.product.syncAll',
          connectionId: mockConnection.id,
          idempotencyKey: `bootstrap:${mockConnection.id}:product:syncAll`,
        })
      );
    });

    it('should skip enqueue when adapter does not support ProductMaster', async () => {
      connectionPort.create.mockResolvedValue(mockConnection);
      integrationsService.getAdapter.mockResolvedValue({
        connection: mockConnection,
        adapter: {},
        metadata: { supportedCapabilities: ['OfferManager'] },
      } as unknown as Awaited<ReturnType<IIntegrationsService['getAdapter']>>);

      await service.create(payload);

      // Narrowed to the product job (#2084): create now also runs a taxonomy
      // bootstrap, so a bare `not.toHaveBeenCalled()` would fail here even
      // though this test's subject — the ProductMaster gate — still holds.
      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalledWith(
        expect.objectContaining({ jobType: 'master.product.syncAll' })
      );
    });

    it('should not fail connection creation when bootstrap enqueue throws', async () => {
      connectionPort.create.mockResolvedValue(mockConnection);
      integrationsService.getAdapter.mockRejectedValue(new Error('adapter resolution failed'));

      await expect(service.create(payload)).resolves.toEqual(mockConnection);
      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalledWith(
        expect.objectContaining({ jobType: 'master.product.syncAll' })
      );
    });

    describe('taxonomy bootstrap (#2084)', () => {
      const shopScope = { taxonomyOwner: null, connectionId: mockConnection.id };

      it('should enqueue destination.taxonomy.sync for a scope with no rows yet', async () => {
        connectionPort.create.mockResolvedValue(mockConnection);
        destinationTaxonomy.resolveScope.mockResolvedValue(shopScope);
        destinationTaxonomy.browse.mockResolvedValue([]);

        await service.create(payload);

        expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
          expect.objectContaining({
            jobType: 'destination.taxonomy.sync',
            connectionId: mockConnection.id,
            payload: { schemaVersion: 1, taxonomyOwner: null },
            idempotencyKey: `bootstrap:${mockConnection.id}:taxonomy:sync`,
          })
        );
      });

      it('should carry the resolved owner in the payload for an owner-keyed marketplace scope', async () => {
        connectionPort.create.mockResolvedValue(mockConnection);
        destinationTaxonomy.resolveScope.mockResolvedValue({
          taxonomyOwner: 'allegro',
          connectionId: null,
        });
        destinationTaxonomy.browse.mockResolvedValue([]);

        await service.create(payload);

        expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
          expect.objectContaining({
            jobType: 'destination.taxonomy.sync',
            payload: { schemaVersion: 1, taxonomyOwner: 'allegro' },
          })
        );
      });

      it('should skip the enqueue when the scope already has root categories', async () => {
        // AC-4: a second marketplace connection joining an already-synced owner
        // must not re-walk thousands of nodes — the per-scope lock only guards
        // a CONCURRENT walk, not a sequential one.
        connectionPort.create.mockResolvedValue(mockConnection);
        destinationTaxonomy.resolveScope.mockResolvedValue({
          taxonomyOwner: 'allegro',
          connectionId: null,
        });
        destinationTaxonomy.browse.mockResolvedValue([
          { externalId: '1', name: 'Root' },
        ] as unknown as Awaited<ReturnType<IDestinationTaxonomyService['browse']>>);

        await service.create(payload);

        expect(jobEnqueue.enqueueJob).not.toHaveBeenCalledWith(
          expect.objectContaining({ jobType: 'destination.taxonomy.sync' })
        );
      });

      it('should skip the enqueue when the connection exposes no taxonomy source', async () => {
        connectionPort.create.mockResolvedValue(mockConnection);
        destinationTaxonomy.resolveScope.mockRejectedValue(
          new Error('TaxonomySourceUnavailableException')
        );

        await service.create(payload);

        expect(jobEnqueue.enqueueJob).not.toHaveBeenCalledWith(
          expect.objectContaining({ jobType: 'destination.taxonomy.sync' })
        );
      });

      it('should not fail connection creation when the taxonomy enqueue throws', async () => {
        connectionPort.create.mockResolvedValue(mockConnection);
        destinationTaxonomy.resolveScope.mockResolvedValue(shopScope);
        destinationTaxonomy.browse.mockResolvedValue([]);
        jobEnqueue.enqueueJob.mockRejectedValue(new Error('stream unavailable'));

        await expect(service.create(payload)).resolves.toEqual(mockConnection);
      });
    });

    // #1498 — stock write-back authority guard + default-off.
    describe('write-back capability defaults and guard (#1498)', () => {
      const woocommerceManifest = {
        adapterKey: 'woocommerce.restapi.v3',
        platformType: 'woocommerce',
        supportedCapabilities: [
          'ProductMaster',
          'InventoryMaster',
          'OrderProcessorManager',
          'OrderSource',
          'ProductPublisher',
          'CategoryProvisioner',
          'OfferManager',
        ],
      };

      it('should exclude OfferManager from defaulted capabilities when the manifest also declares InventoryMaster', async () => {
        integrationsService.resolveAdapterMetadata.mockResolvedValueOnce(
          woocommerceManifest as never
        );
        connectionPort.create.mockResolvedValue(mockConnection);

        await service.create({ ...payload, platformType: 'woocommerce' });

        const created = connectionPort.create.mock.calls[0][0] as {
          enabledCapabilities: string[];
        };
        expect(created.enabledCapabilities).not.toContain('OfferManager');
        expect(created.enabledCapabilities).toContain('InventoryMaster');
        expect(created.enabledCapabilities).toContain('ProductPublisher');
      });

      it('should keep the full defaulted capability set for marketplace manifests without InventoryMaster', async () => {
        // Synthetic marketplace adapterKey with no registered config-shape
        // validator, so the test exercises only the capability-defaulting path.
        integrationsService.resolveAdapterMetadata.mockResolvedValueOnce({
          adapterKey: 'marketplace.test.v1',
          platformType: 'test-marketplace',
          supportedCapabilities: ['OrderSource', 'OfferManager'],
        } as never);
        connectionPort.create.mockResolvedValue(mockConnection);

        await service.create({ ...payload, platformType: 'test-marketplace' });

        const created = connectionPort.create.mock.calls[0][0] as {
          enabledCapabilities: string[];
        };
        expect(created.enabledCapabilities).toContain('OfferManager');
      });

      it('should reject create when InventoryMaster and OfferManager are both explicitly enabled', async () => {
        integrationsService.resolveAdapterMetadata.mockResolvedValueOnce(
          woocommerceManifest as never
        );

        await expect(
          service.create({
            ...payload,
            platformType: 'woocommerce',
            enabledCapabilities: ['InventoryMaster', 'OfferManager'] as never,
          })
        ).rejects.toThrow(/cannot both be enabled/);
        expect(connectionPort.create).not.toHaveBeenCalled();
      });

      it('should allow create with OfferManager enabled when InventoryMaster is not requested', async () => {
        integrationsService.resolveAdapterMetadata.mockResolvedValueOnce(
          woocommerceManifest as never
        );
        connectionPort.create.mockResolvedValue(mockConnection);

        await expect(
          service.create({
            ...payload,
            platformType: 'woocommerce',
            enabledCapabilities: ['OfferManager', 'ProductPublisher'] as never,
          })
        ).resolves.toEqual(mockConnection);
      });
    });

    // #509 — create-path config validation. Mirrors the update-path hook
    // (#437) so that operators get the same 400 surface on POST /connections
    // as they do on PATCH /connections/:id.
    describe('config validation on create (#509)', () => {
      it('should reject PrestaShop create with invalid baseUrl', async () => {
        await expect(
          service.create({
            ...payload,
            config: { baseUrl: 'shop.example.com' }, // missing protocol
          })
        ).rejects.toThrow(BadRequestException);
        expect(connectionPort.create).not.toHaveBeenCalled();
      });

      it('should reject PrestaShop create with defaultCarrierId of 0', async () => {
        await expect(
          service.create({
            ...payload,
            config: { baseUrl: 'https://shop.example.com', defaultCarrierId: 0 },
          })
        ).rejects.toThrow(BadRequestException);
        expect(connectionPort.create).not.toHaveBeenCalled();
      });

      it('should reject Allegro create with malformed sellerDefaults', async () => {
        // Side effect of #509 wiring: Allegro create is now validated too.
        // Closes the same DTO bypass that #437 only fixed on update.
        integrationsService.resolveAdapterMetadata.mockResolvedValueOnce({
          adapterKey: 'allegro.publicapi.v1',
          platformType: 'allegro',
          supportedCapabilities: ['OrderSource', 'OfferManager'],
        });
        await expect(
          service.create({
            name: 'Allegro Conn',
            platformType: 'allegro',
            credentialsRef: 'db:existing-ref',
            config: {
              environment: 'sandbox',
              sellerDefaults: {
                location: { countryCode: 'PL' }, // missing province/city/postCode
                responsibleProducerId: 'rp-1',
                safetyInformation: { type: 'NO_SAFETY_INFORMATION' },
              },
            },
          })
        ).rejects.toThrow(BadRequestException);
        expect(connectionPort.create).not.toHaveBeenCalled();
      });

      it('should skip create-path validation for platforms with no validator', async () => {
        integrationsService.resolveAdapterMetadata.mockResolvedValueOnce({
          adapterKey: 'shopify.unknown.v1',
          platformType: 'shopify',
          supportedCapabilities: [],
        });
        connectionPort.create.mockResolvedValue(mockConnection);

        await expect(
          service.create({
            name: 'Shopify Conn',
            platformType: 'shopify',
            credentialsRef: 'db:existing-ref',
            config: { whatever: 'goes' },
          })
        ).resolves.toEqual(mockConnection);
        expect(connectionPort.create).toHaveBeenCalled();
      });
    });

    describe('config.rateLimit validation (#1810)', () => {
      it('should accept a create with both knobs within bounds', async () => {
        connectionPort.create.mockResolvedValue(mockConnection);

        await expect(
          service.create({
            ...payload,
            config: { ...payload.config, rateLimit: { requestsPerMinute: 60, maxConcurrent: 4 } },
          })
        ).resolves.toEqual(mockConnection);
        expect(connectionPort.create).toHaveBeenCalled();
      });

      it('should accept a create with config.rateLimit absent — unlimited, byte-identical to today', async () => {
        connectionPort.create.mockResolvedValue(mockConnection);

        await expect(service.create(payload)).resolves.toEqual(mockConnection);
        expect(connectionPort.create).toHaveBeenCalledWith(
          expect.objectContaining({ config: payload.config })
        );
      });

      it('should reject a create with requestsPerMinute below 1', async () => {
        await expect(
          service.create({
            ...payload,
            config: { ...payload.config, rateLimit: { requestsPerMinute: 0 } },
          })
        ).rejects.toThrow(BadRequestException);
        expect(connectionPort.create).not.toHaveBeenCalled();
      });

      it('should reject a create with requestsPerMinute above 6000', async () => {
        await expect(
          service.create({
            ...payload,
            config: { ...payload.config, rateLimit: { requestsPerMinute: 6001 } },
          })
        ).rejects.toThrow(BadRequestException);
        expect(connectionPort.create).not.toHaveBeenCalled();
      });

      it('should reject a create with maxConcurrent above 64', async () => {
        await expect(
          service.create({
            ...payload,
            config: { ...payload.config, rateLimit: { maxConcurrent: 65 } },
          })
        ).rejects.toThrow(BadRequestException);
        expect(connectionPort.create).not.toHaveBeenCalled();
      });

      it('should reject a create with a non-object rateLimit', async () => {
        await expect(
          service.create({
            ...payload,
            config: { ...payload.config, rateLimit: 'fast' as unknown as ConnectionRateLimit },
          })
        ).rejects.toThrow(BadRequestException);
        expect(connectionPort.create).not.toHaveBeenCalled();
      });

      it('should update accepting a valid rateLimit and never default a value into stored config', async () => {
        connectionPort.get.mockResolvedValue(mockConnection);
        connectionPort.update.mockResolvedValue(mockConnection);
        const config = { baseUrl: 'https://shop.example.com', rateLimit: { requestsPerMinute: 30 } };

        await expect(
          service.update('connection-123', { config })
        ).resolves.toEqual(mockConnection);
        expect(connectionPort.update).toHaveBeenCalledWith('connection-123', { config });
      });

      it('should reject an update with an out-of-bounds maxConcurrent', async () => {
        connectionPort.get.mockResolvedValue(mockConnection);

        await expect(
          service.update('connection-123', {
            config: { baseUrl: 'https://shop.example.com', rateLimit: { maxConcurrent: 0 } },
          })
        ).rejects.toThrow(BadRequestException);
        expect(connectionPort.update).not.toHaveBeenCalled();
      });
    });

    describe('neutral stock and pricing config validation (#2610)', () => {
      it('should accept a create carrying all three keys within bounds', async () => {
        connectionPort.create.mockResolvedValue(mockConnection);

        await expect(
          service.create({
            ...payload,
            config: {
              ...payload.config,
              stockSafetyBuffer: 3,
              stockZeroThreshold: 5,
              pricingRule: { type: 'margin', percent: 33.333, rounding: 'endingIn99' },
            },
          })
        ).resolves.toEqual(mockConnection);
        expect(connectionPort.create).toHaveBeenCalled();
      });

      it('should reject a margin of 100% or more, which core degrades to the catalogue price', async () => {
        await expect(
          service.create({
            ...payload,
            config: { ...payload.config, pricingRule: { type: 'margin', percent: 120 } },
          })
        ).rejects.toThrow(BadRequestException);
        expect(connectionPort.create).not.toHaveBeenCalled();
      });

      it('should accept a markup of 100% or more, which is a real price above the catalogue', async () => {
        connectionPort.create.mockResolvedValue(mockConnection);

        await expect(
          service.create({
            ...payload,
            config: { ...payload.config, pricingRule: { type: 'markup', percent: 120 } },
          })
        ).resolves.toEqual(mockConnection);
      });

      it('should reject a negative buffer and a non-numeric threshold', async () => {
        await expect(
          service.create({ ...payload, config: { ...payload.config, stockSafetyBuffer: -1 } })
        ).rejects.toThrow(BadRequestException);
        await expect(
          service.create({
            ...payload,
            config: { ...payload.config, stockZeroThreshold: '5' as unknown as number },
          })
        ).rejects.toThrow(BadRequestException);
        expect(connectionPort.create).not.toHaveBeenCalled();
      });

      it('should reject an unknown pricing rule type', async () => {
        await expect(
          service.create({
            ...payload,
            // A shape only a non-browser caller can send, which is the point.
            config: {
              ...payload.config,
              pricingRule: { type: 'discount', percent: 10 } as unknown as PricingRule,
            },
          })
        ).rejects.toThrow(BadRequestException);
        expect(connectionPort.create).not.toHaveBeenCalled();
      });

      it('should reject the same values on update, which is the path the raw JSON editor takes', async () => {
        connectionPort.get.mockResolvedValue(mockConnection);

        await expect(
          service.update('connection-123', {
            config: {
              baseUrl: 'https://shop.example.com',
              pricingRule: { type: 'margin', percent: 100 },
            },
          })
        ).rejects.toThrow(BadRequestException);
        expect(connectionPort.update).not.toHaveBeenCalled();
      });

      it('should leave a config with none of the three keys untouched', async () => {
        connectionPort.get.mockResolvedValue(mockConnection);
        connectionPort.update.mockResolvedValue(mockConnection);
        const config = { baseUrl: 'https://shop.example.com' };

        await expect(service.update('connection-123', { config })).resolves.toEqual(mockConnection);
        expect(connectionPort.update).toHaveBeenCalledWith('connection-123', { config });
      });
    });
  });

  describe('list', () => {
    it('should return list of connections', async () => {
      connectionPort.list.mockResolvedValue([mockConnection]);

      const result = await service.list();

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(mockConnection);
    });

    it('should pass filters to port', async () => {
      const filters: ConnectionFilters = { platformType: 'prestashop' };
      connectionPort.list.mockResolvedValue([mockConnection]);

      await service.list(filters);

      expect(connectionPort.list).toHaveBeenCalledWith(filters);
    });
  });

  describe('get', () => {
    it('should return connection when found', async () => {
      connectionPort.get.mockResolvedValue(mockConnection);

      const result = await service.get('connection-123');

      expect(result).toEqual(mockConnection);
    });

    it('should throw NotFoundException when connection not found', async () => {
      connectionPort.get.mockRejectedValue(new ConnectionNotFoundException('connection-123'));

      await expect(service.get('connection-123')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update and return connection', async () => {
      const patch: ConnectionUpdate = { name: 'Updated Name' };
      const updatedConnection = new Connection(
        'connection-123',
        'prestashop',
        'Updated Name',
        'active',
        {},
        'cred_123',
        new Date(),
        new Date(),

        undefined,
        ['ProductMaster', 'InventoryMaster', 'OrderSource', 'OrderProcessorManager', 'OfferManager']
      );

      connectionPort.get.mockResolvedValue(mockConnection);
      connectionPort.update.mockResolvedValue(updatedConnection);

      const result = await service.update('connection-123', patch);

      expect(result).toEqual(updatedConnection);
      expect(connectionPort.update).toHaveBeenCalledWith('connection-123', patch);
    });

    describe('taxonomy bootstrap on enable (#2084)', () => {
      const withStatus = (status: 'active' | 'disabled'): Connection =>
        new Connection(
          'connection-123',
          'prestashop',
          'Test Connection',
          status,
          {},
          'cred_123',
          new Date(),
          new Date(),
          undefined,
          ['ProductPublisher']
        );

      beforeEach(() => {
        destinationTaxonomy.resolveScope.mockResolvedValue({
          taxonomyOwner: null,
          connectionId: 'connection-123',
        });
        destinationTaxonomy.browse.mockResolvedValue([]);
      });

      it('should enqueue the bootstrap when a disabled connection transitions to active', async () => {
        // A connection created disabled skipped the create-time bootstrap (its
        // adapter could not resolve), so enabling is when its tree first
        // becomes fetchable.
        connectionPort.get.mockResolvedValue(withStatus('disabled'));
        connectionPort.update.mockResolvedValue(withStatus('active'));

        await service.update('connection-123', { status: 'active' } as ConnectionUpdate);

        expect(jobEnqueue.enqueueJob).toHaveBeenCalledWith(
          expect.objectContaining({
            jobType: 'destination.taxonomy.sync',
            idempotencyKey: 'bootstrap:connection-123:taxonomy:sync',
          })
        );
      });

      it('should not enqueue when the connection was already active', async () => {
        connectionPort.get.mockResolvedValue(withStatus('active'));
        connectionPort.update.mockResolvedValue(withStatus('active'));

        await service.update('connection-123', { name: 'Renamed' } as ConnectionUpdate);

        expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
      });

      it('should not enqueue when the patch leaves the connection disabled', async () => {
        connectionPort.get.mockResolvedValue(withStatus('disabled'));
        connectionPort.update.mockResolvedValue(withStatus('disabled'));

        await service.update('connection-123', { name: 'Renamed' } as ConnectionUpdate);

        expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
      });

      it('should not fail the update when the bootstrap enqueue throws', async () => {
        connectionPort.get.mockResolvedValue(withStatus('disabled'));
        const enabled = withStatus('active');
        connectionPort.update.mockResolvedValue(enabled);
        jobEnqueue.enqueueJob.mockRejectedValue(new Error('stream unavailable'));

        await expect(
          service.update('connection-123', { status: 'active' } as ConnectionUpdate)
        ).resolves.toEqual(enabled);
      });
    });

    it('should throw NotFoundException when connection not found', async () => {
      connectionPort.get.mockRejectedValue(new ConnectionNotFoundException('connection-123'));

      await expect(service.update('connection-123', { name: 'Updated' })).rejects.toThrow(
        NotFoundException
      );
    });

    // #1498 — write-back authority guard on the update path.
    describe('write-back capability guard on update (#1498)', () => {
      it('should reject update when the patch enables InventoryMaster and OfferManager together', async () => {
        connectionPort.get.mockResolvedValue(mockConnection);
        integrationsService.resolveAdapterMetadata.mockResolvedValueOnce({
          adapterKey: 'woocommerce.restapi.v3',
          platformType: 'woocommerce',
          supportedCapabilities: ['InventoryMaster', 'OfferManager', 'ProductPublisher'],
        } as never);

        await expect(
          service.update('connection-123', {
            enabledCapabilities: ['InventoryMaster', 'OfferManager'] as never,
          })
        ).rejects.toThrow(/cannot both be enabled/);
        expect(connectionPort.update).not.toHaveBeenCalled();
      });

      it('should allow update enabling OfferManager alone', async () => {
        connectionPort.get.mockResolvedValue(mockConnection);
        connectionPort.update.mockResolvedValue(mockConnection);
        integrationsService.resolveAdapterMetadata.mockResolvedValueOnce({
          adapterKey: 'woocommerce.restapi.v3',
          platformType: 'woocommerce',
          supportedCapabilities: ['InventoryMaster', 'OfferManager', 'ProductPublisher'],
        } as never);

        await expect(
          service.update('connection-123', {
            enabledCapabilities: ['OfferManager', 'ProductPublisher'] as never,
          })
        ).resolves.toEqual(mockConnection);
      });
    });

    // #437 — service-layer Allegro config validation. Closes the bypass on
    // `UpdateConnectionDto.config: Record<string, unknown>` by re-validating
    // the platform-specific shape before persistence.
    describe('Allegro config validation (#437)', () => {
      const allegroConnection = new Connection(
        'allegro-conn-1',
        'allegro',
        'Allegro PL',
        'active',
        { environment: 'sandbox' },
        'db:cred-ref-allegro',
        new Date(),
        new Date(),
        undefined,
        ['OrderSource', 'OfferManager']
      );

      const validAllegroConfig = {
        environment: 'sandbox',
        sellerDefaults: {
          location: {
            countryCode: 'PL',
            province: 'MAZOWIECKIE',
            city: 'Warszawa',
            postCode: '00-001',
          },
          responsibleProducerId: 'rp-123',
          safetyInformation: { type: 'NO_SAFETY_INFORMATION' },
        },
      };

      beforeEach(() => {
        connectionPort.get.mockResolvedValue(allegroConnection);
        connectionPort.update.mockResolvedValue(allegroConnection);
        // resolveAdapterMetadata picks the adapterKey used to look up the
        // shape-validator registry — pin it to Allegro for this describe.
        integrationsService.resolveAdapterMetadata.mockResolvedValue({
          adapterKey: 'allegro.publicapi.v1',
          platformType: 'allegro',
          supportedCapabilities: ['OrderSource', 'OfferManager'],
        });
      });

      it('should accept a fully-formed Allegro config', async () => {
        await expect(
          service.update('allegro-conn-1', { config: validAllegroConfig })
        ).resolves.toEqual(allegroConnection);
        expect(connectionPort.update).toHaveBeenCalledWith('allegro-conn-1', {
          config: validAllegroConfig,
        });
      });

      it('should reject sellerDefaults missing location.countryCode', async () => {
        const partial = {
          ...validAllegroConfig,
          sellerDefaults: {
            ...validAllegroConfig.sellerDefaults,
            location: { ...validAllegroConfig.sellerDefaults.location, countryCode: undefined },
          },
        };
        await expect(service.update('allegro-conn-1', { config: partial })).rejects.toThrow(
          BadRequestException
        );
        expect(connectionPort.update).not.toHaveBeenCalled();
      });

      it('should reject sellerDefaults missing responsibleProducerId', async () => {
        const partial = {
          ...validAllegroConfig,
          sellerDefaults: {
            ...validAllegroConfig.sellerDefaults,
            responsibleProducerId: undefined,
          },
        };
        await expect(service.update('allegro-conn-1', { config: partial })).rejects.toThrow(
          BadRequestException
        );
        expect(connectionPort.update).not.toHaveBeenCalled();
      });

      it('should reject sellerDefaults missing safetyInformation.type', async () => {
        const partial = {
          ...validAllegroConfig,
          sellerDefaults: {
            ...validAllegroConfig.sellerDefaults,
            safetyInformation: {},
          },
        };
        await expect(service.update('allegro-conn-1', { config: partial })).rejects.toThrow(
          BadRequestException
        );
        expect(connectionPort.update).not.toHaveBeenCalled();
      });

      it('should reject TEXT without description (#445)', async () => {
        const partial = {
          ...validAllegroConfig,
          sellerDefaults: {
            ...validAllegroConfig.sellerDefaults,
            safetyInformation: { type: 'TEXT' },
          },
        };
        await expect(service.update('allegro-conn-1', { config: partial })).rejects.toThrow(
          BadRequestException
        );
        expect(connectionPort.update).not.toHaveBeenCalled();
      });

      it('should reject ATTACHMENTS without attachments array (#445)', async () => {
        const partial = {
          ...validAllegroConfig,
          sellerDefaults: {
            ...validAllegroConfig.sellerDefaults,
            safetyInformation: { type: 'ATTACHMENTS' },
          },
        };
        await expect(service.update('allegro-conn-1', { config: partial })).rejects.toThrow(
          BadRequestException
        );
        expect(connectionPort.update).not.toHaveBeenCalled();
      });

      it('should reject ATTACHMENTS exceeding 20 entries (#445)', async () => {
        const tooMany = Array.from({ length: 21 }, (_, i) => ({ id: `att-${i}` }));
        const partial = {
          ...validAllegroConfig,
          sellerDefaults: {
            ...validAllegroConfig.sellerDefaults,
            safetyInformation: { type: 'ATTACHMENTS', attachments: tooMany },
          },
        };
        await expect(service.update('allegro-conn-1', { config: partial })).rejects.toThrow(
          BadRequestException
        );
        expect(connectionPort.update).not.toHaveBeenCalled();
      });

      it('should accept TEXT with valid description (#445)', async () => {
        const partial = {
          ...validAllegroConfig,
          sellerDefaults: {
            ...validAllegroConfig.sellerDefaults,
            safetyInformation: {
              type: 'TEXT',
              description: 'Aparat z akumulatorem litowo-jonowym. Spelnia normy CE/RoHS.',
            },
          },
        };
        await expect(service.update('allegro-conn-1', { config: partial })).resolves.toEqual(
          allegroConnection
        );
        expect(connectionPort.update).toHaveBeenCalled();
      });

      it('should skip config validation when no validator is registered for the platform', async () => {
        // A platform with no validator (e.g. a hypothetical `shopify`) must
        // skip the validation pass and persist whatever blob the operator
        // sent. CONNECTION_CONFIG_VALIDATORS lookup returns `undefined` and
        // the call site short-circuits.
        const shopifyConnection = new Connection(
          'shopify-conn-1',
          'shopify',
          'Shopify Store',
          'active',
          {},
          'db:cred-ref-shopify',
          new Date(),
          new Date(),
          undefined,
          []
        );
        connectionPort.get.mockResolvedValue(shopifyConnection);
        connectionPort.update.mockResolvedValue(shopifyConnection);
        // Override the Allegro adapterKey set by the surrounding beforeEach
        // to a key that isn't registered in the validator registry; the
        // shape-validation pass should short-circuit and persist the blob.
        integrationsService.resolveAdapterMetadata.mockResolvedValueOnce({
          adapterKey: 'shopify.unknown.v1',
          platformType: 'shopify',
          supportedCapabilities: [],
        });

        await expect(
          service.update('shopify-conn-1', {
            config: { whatever: 'goes' },
          })
        ).resolves.toEqual(shopifyConnection);
        expect(connectionPort.update).toHaveBeenCalled();
      });
    });

    // #509 — service-layer PrestaShop config validation. Closes the same
    // bypass on `UpdateConnectionDto.config: Record<string, unknown>` for
    // the PrestaShop side (#437 wired Allegro only).
    describe('PrestaShop config validation (#509)', () => {
      const prestashopConnection = new Connection(
        'ps-conn-1',
        'prestashop',
        'PS Shop',
        'active',
        { baseUrl: 'https://shop.example.com' },
        'db:cred-ref-ps',
        new Date(),
        new Date(),
        undefined,
        ['ProductMaster', 'InventoryMaster', 'OrderSource', 'OrderProcessorManager']
      );

      const validPsConfig = {
        baseUrl: 'https://shop.example.com',
        shopId: 1,
        defaultCarrierId: 2,
        guestCustomerGroupId: 2,
        currency: 'PLN',
        responseFormat: 'auto' as const,
      };

      beforeEach(() => {
        connectionPort.get.mockResolvedValue(prestashopConnection);
        connectionPort.update.mockResolvedValue(prestashopConnection);
      });

      it('should accept a fully-formed PrestaShop config', async () => {
        await expect(service.update('ps-conn-1', { config: validPsConfig })).resolves.toEqual(
          prestashopConnection
        );
        expect(connectionPort.update).toHaveBeenCalledWith('ps-conn-1', {
          config: validPsConfig,
        });
      });

      it('should reject baseUrl missing protocol', async () => {
        await expect(
          service.update('ps-conn-1', {
            config: { ...validPsConfig, baseUrl: 'shop.example.com' },
          })
        ).rejects.toThrow(BadRequestException);
        expect(connectionPort.update).not.toHaveBeenCalled();
      });

      it('should reject defaultCarrierId of 0', async () => {
        await expect(
          service.update('ps-conn-1', {
            config: { ...validPsConfig, defaultCarrierId: 0 },
          })
        ).rejects.toThrow(BadRequestException);
        expect(connectionPort.update).not.toHaveBeenCalled();
      });

      it('should reject negative guestCustomerGroupId', async () => {
        await expect(
          service.update('ps-conn-1', {
            config: { ...validPsConfig, guestCustomerGroupId: -1 },
          })
        ).rejects.toThrow(BadRequestException);
        expect(connectionPort.update).not.toHaveBeenCalled();
      });

      it('should reject lowercase currency', async () => {
        await expect(
          service.update('ps-conn-1', {
            config: { ...validPsConfig, currency: 'pln' },
          })
        ).rejects.toThrow(BadRequestException);
        expect(connectionPort.update).not.toHaveBeenCalled();
      });

      it('should reject responseFormat outside the allowed set', async () => {
        await expect(
          service.update('ps-conn-1', {
            config: { ...validPsConfig, responseFormat: 'csv' },
          })
        ).rejects.toThrow(BadRequestException);
        expect(connectionPort.update).not.toHaveBeenCalled();
      });

      it('should reject timeoutMs above the sanity max', async () => {
        await expect(
          service.update('ps-conn-1', {
            config: { ...validPsConfig, timeoutMs: 999999999 },
          })
        ).rejects.toThrow(BadRequestException);
        expect(connectionPort.update).not.toHaveBeenCalled();
      });

      it('should reject pageSize above the sanity max', async () => {
        await expect(
          service.update('ps-conn-1', {
            config: { ...validPsConfig, pageSize: 5000 },
          })
        ).rejects.toThrow(BadRequestException);
        expect(connectionPort.update).not.toHaveBeenCalled();
      });

      it('should accept config with adjacent unknown keys (whitelist=false)', async () => {
        // The validator owns shape-correctness on what the DTO describes,
        // not exhaustive ownership of the JSONB blob. Adjacent keys must not
        // raise.
        await expect(
          service.update('ps-conn-1', {
            config: { ...validPsConfig, futureFlag: true },
          })
        ).resolves.toEqual(prestashopConnection);
        expect(connectionPort.update).toHaveBeenCalled();
      });

      it('should reject paymentModuleOverrides containing non-string entries', async () => {
        await expect(
          service.update('ps-conn-1', {
            config: { ...validPsConfig, paymentModuleOverrides: ['ok', 42] },
          })
        ).rejects.toThrow(BadRequestException);
        expect(connectionPort.update).not.toHaveBeenCalled();
      });
    });
  });

  describe('updateCredentials', () => {
    it('should rotate credentials for a db-backed connection', async () => {
      const dbConnection = new Connection(
        'connection-123',
        'prestashop',
        'Test Connection',
        'active',
        {},
        'db:cred-ref-1',
        new Date(),
        new Date(),
        undefined,
        ['ProductMaster']
      );
      connectionPort.get.mockResolvedValue(dbConnection);

      await service.updateCredentials('connection-123', { webserviceApiKey: 'NEW' });

      expect(credentials.update).toHaveBeenCalledWith('cred-ref-1', {
        credentialsJson: { webserviceApiKey: 'NEW' },
      });
    });

    it('should merge onto existing stored fields instead of replacing the whole blob', async () => {
      const dbConnection = new Connection(
        'connection-123',
        'prestashop',
        'Test Connection',
        'active',
        {},
        'db:cred-ref-1',
        new Date(),
        new Date(),
        undefined,
        ['ProductMaster']
      );
      connectionPort.get.mockResolvedValue(dbConnection);
      credentials.getByRef.mockResolvedValue({
        id: 'cred-row-1',
        ref: 'cred-ref-1',
        platformType: 'prestashop',
        credentialsJson: { webserviceApiKey: 'OLD', otherField: 'keep-me' },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await service.updateCredentials('connection-123', { webserviceApiKey: 'NEW' });

      expect(credentials.update).toHaveBeenCalledWith('cred-ref-1', {
        credentialsJson: { webserviceApiKey: 'NEW', otherField: 'keep-me' },
      });
    });

    it('should reject rotation on non-db-backed connection', async () => {
      const legacy = new Connection(
        'connection-123',
        'prestashop',
        'Test Connection',
        'active',
        {},
        'LEGACY_RAW_KEY',
        new Date(),
        new Date(),
        undefined,
        ['ProductMaster']
      );
      connectionPort.get.mockResolvedValue(legacy);

      await expect(
        service.updateCredentials('connection-123', { webserviceApiKey: 'NEW' })
      ).rejects.toThrow(/does not have a db-backed/);
      expect(credentials.update).not.toHaveBeenCalled();
    });

    describe('credentials rewriter dispatch (#1387, ADR-031)', () => {
      // ConnectionService has zero platform-specific knowledge of what a
      // rewriter does (that logic — e.g. Erli's Allegro-credentials-reuse
      // resolution — lives behind `ConnectionCredentialsRewriterPort` in the
      // owning plugin package and is unit-tested there). These tests only
      // pin the generic dispatch contract: no-op passthrough when nothing is
      // registered for the adapterKey, and delegation + error-mapping when a
      // rewriter is registered.
      const dbConnection = new Connection(
        'connection-123',
        'prestashop',
        'Test Connection',
        'active',
        {},
        'db:cred-ref-1',
        new Date(),
        new Date(),
        undefined,
        ['ProductMaster']
      );

      beforeEach(() => {
        connectionPort.get.mockResolvedValue(dbConnection);
        credentials.getByRef.mockResolvedValue({
          id: 'cred-row-1',
          ref: 'cred-ref-1',
          platformType: 'prestashop',
          credentialsJson: { webserviceApiKey: 'EXISTING' },
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      });

      it('should pass the credentials through unchanged when no rewriter is registered for the adapterKey', async () => {
        await service.updateCredentials('connection-123', { webserviceApiKey: 'NEW' });

        expect(credentials.update).toHaveBeenCalledWith('cred-ref-1', {
          credentialsJson: { webserviceApiKey: 'NEW' },
        });
      });

      it('should delegate to the registered rewriter and persist its returned payload', async () => {
        const stubRewriter: jest.Mocked<ConnectionCredentialsRewriterPort> = {
          rewrite: jest
            .fn()
            .mockResolvedValue({ webserviceApiKey: 'REWRITTEN', extraField: 'added-by-rewriter' }),
        };
        credentialsRewriterRegistry.register('prestashop.webservice.v1', stubRewriter);

        await service.updateCredentials('connection-123', { webserviceApiKey: 'NEW' });

        expect(stubRewriter.rewrite).toHaveBeenCalledWith({ webserviceApiKey: 'NEW' });
        expect(credentials.update).toHaveBeenCalledWith('cred-ref-1', {
          credentialsJson: { webserviceApiKey: 'REWRITTEN', extraField: 'added-by-rewriter' },
        });
      });

      it('should map a ConnectionCredentialsRewriteException from the rewriter to BadRequestException', async () => {
        const stubRewriter: jest.Mocked<ConnectionCredentialsRewriterPort> = {
          rewrite: jest
            .fn()
            .mockRejectedValue(
              new ConnectionCredentialsRewriteException('Stub', 'source connection is invalid')
            ),
        };
        credentialsRewriterRegistry.register('prestashop.webservice.v1', stubRewriter);

        await expect(
          service.updateCredentials('connection-123', { webserviceApiKey: 'NEW' })
        ).rejects.toThrow(BadRequestException);
        expect(credentials.update).not.toHaveBeenCalled();
      });
    });
  });

  describe('testConnection', () => {
    it('should delegate to the registered tester and return result', async () => {
      connectionPort.get.mockResolvedValue(mockConnection);
      mockTester.test.mockResolvedValue({
        success: true,
        status: 200,
        message: 'OK',
        latencyMs: 123,
      });

      const result = await service.testConnection('connection-123');

      expect(result).toEqual({ success: true, status: 200, message: 'OK', latencyMs: 123 });
      expect(mockTester.test).toHaveBeenCalledWith(mockConnection, expect.anything());
    });

    it('should throw BadRequest when no tester is registered for the adapter', async () => {
      const adapterLessConnection = new Connection(
        'connection-999',
        'unknown-platform',
        'X',
        'active',
        {},
        'db:ref',
        new Date(),
        new Date(),
        undefined,
        []
      );
      connectionPort.get.mockResolvedValue(adapterLessConnection);
      integrationsService.resolveAdapterMetadata.mockResolvedValue({
        adapterKey: 'unknown.v1',
        platformType: 'unknown-platform',
        supportedCapabilities: [],
      });

      await expect(service.testConnection('connection-999')).rejects.toThrow(/not supported/);
    });
  });

  describe('installWebhooks', () => {
    it('should delegate to the registered provisioner and return the result', async () => {
      connectionPort.get.mockResolvedValue(mockConnection);
      mockWebhookProvisioner.install.mockResolvedValue({
        webhooksConfigured: true,
        testPingTriggered: true,
      });

      const result = await service.installWebhooks('connection-123', 'user-1');

      expect(result).toEqual({
        webhooksConfigured: true,
        testPingTriggered: true,
      });
      expect(mockWebhookProvisioner.install).toHaveBeenCalledWith('connection-123', 'user-1');
    });

    it('should throw BadRequest when no provisioner is registered for the adapter', async () => {
      const adapterLessConnection = new Connection(
        'connection-999',
        'unknown-platform',
        'X',
        'active',
        {},
        'db:ref',
        new Date(),
        new Date(),
        undefined,
        []
      );
      connectionPort.get.mockResolvedValue(adapterLessConnection);
      integrationsService.resolveAdapterMetadata.mockResolvedValue({
        adapterKey: 'unknown.v1',
        platformType: 'unknown-platform',
        supportedCapabilities: [],
      });

      await expect(service.installWebhooks('connection-999')).rejects.toThrow(BadRequestException);
      await expect(service.installWebhooks('connection-999')).rejects.toThrow(/not supported/);
    });
  });

  describe('disable', () => {
    it('should disable and return connection', async () => {
      const disabledConnection = new Connection(
        'connection-123',
        'prestashop',
        'Test Connection',
        'disabled',
        {},
        'cred_123',
        new Date(),
        new Date(),

        undefined,
        ['ProductMaster', 'InventoryMaster', 'OrderSource', 'OrderProcessorManager', 'OfferManager']
      );

      connectionPort.disable.mockResolvedValue(disabledConnection);

      const result = await service.disable('connection-123');

      expect(result.status).toBe('disabled');
      expect(connectionPort.disable).toHaveBeenCalledWith('connection-123');
    });

    it('should evict the connection from the rate-limiter/transport cache so it stops leaking process memory', async () => {
      const disabledConnection = new Connection(
        'connection-123',
        'prestashop',
        'Test Connection',
        'disabled',
        {},
        'cred_123',
        new Date(),
        new Date(),

        undefined,
        ['ProductMaster']
      );

      connectionPort.disable.mockResolvedValue(disabledConnection);

      await service.disable('connection-123');

      expect(mockHttpTransportFactory.evict).toHaveBeenCalledWith('connection-123');
    });

    it('should throw NotFoundException when connection not found', async () => {
      connectionPort.disable.mockRejectedValue(new ConnectionNotFoundException('connection-123'));

      await expect(service.disable('connection-123')).rejects.toThrow(NotFoundException);
    });
  });
});
