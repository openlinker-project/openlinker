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
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ConnectionService } from './connection.service';
import type {
  ConnectionPort,
  ConnectionUpdate,
  ConnectionFilters,
} from '@openlinker/core/identifier-mapping';
import {
  CONNECTION_PORT_TOKEN,
  Connection,
  ConnectionNotFoundException,
} from '@openlinker/core/identifier-mapping';
import type {
  IIntegrationsService,
  IntegrationCredentialRepositoryPort,
  CredentialsResolverPort,
  ConnectionTesterPort,
  WebhookProvisioningPort,
} from '@openlinker/core/integrations';
import {
  INTEGRATIONS_SERVICE_TOKEN,
  INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN,
  ConnectionTesterRegistryService,
  CONNECTION_TESTER_REGISTRY_TOKEN,
  CREDENTIALS_RESOLVER_TOKEN,
  WebhookProvisioningRegistryService,
  WEBHOOK_PROVISIONING_REGISTRY_TOKEN,
  ConnectionConfigShapeValidatorRegistryService,
  CONNECTION_CONFIG_SHAPE_VALIDATOR_REGISTRY_TOKEN,
  ConnectionCredentialsShapeValidatorRegistryService,
  CONNECTION_CREDENTIALS_SHAPE_VALIDATOR_REGISTRY_TOKEN,
} from '@openlinker/core/integrations';
import { AllegroConnectionConfigShapeValidatorAdapter } from '@openlinker/integrations-allegro';
import {
  PrestashopConnectionConfigShapeValidatorAdapter,
  PrestashopConnectionCredentialsShapeValidatorAdapter,
} from '@openlinker/integrations-prestashop';
import type { JobEnqueuePort } from '@openlinker/core/sync';
import { JOB_ENQUEUE_TOKEN } from '@openlinker/core/sync';
import type { ConnectionCreateInput } from '../interfaces/connection.service.types';

describe('ConnectionService', () => {
  let service: ConnectionService;
  let connectionPort: jest.Mocked<ConnectionPort>;
  let integrationsService: jest.Mocked<IIntegrationsService>;
  let jobEnqueue: jest.Mocked<JobEnqueuePort>;
  let credentialRepository: jest.Mocked<IntegrationCredentialRepositoryPort>;
  let testerRegistry: ConnectionTesterRegistryService;
  let mockTester: jest.Mocked<ConnectionTesterPort>;
  let webhookProvisioningRegistry: WebhookProvisioningRegistryService;
  let mockWebhookProvisioner: jest.Mocked<WebhookProvisioningPort>;
  let configValidatorRegistry: ConnectionConfigShapeValidatorRegistryService;
  let credentialsValidatorRegistry: ConnectionCredentialsShapeValidatorRegistryService;

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

    const mockCredentialRepository = {
      getByRef: jest.fn(),
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
              encrypted: false,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
        ),
      update: jest.fn(),
      delete: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<IntegrationCredentialRepositoryPort>;

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

    const mockCredentialsResolver: CredentialsResolverPort = {
      get: jest.fn(),
    } as unknown as CredentialsResolverPort;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConnectionService,
        { provide: CONNECTION_PORT_TOKEN, useValue: mockConnectionPort },
        { provide: INTEGRATIONS_SERVICE_TOKEN, useValue: mockIntegrationsService },
        { provide: JOB_ENQUEUE_TOKEN, useValue: mockJobEnqueue },
        { provide: INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN, useValue: mockCredentialRepository },
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
        { provide: CREDENTIALS_RESOLVER_TOKEN, useValue: mockCredentialsResolver },
      ],
    }).compile();

    service = module.get<ConnectionService>(ConnectionService);
    connectionPort = module.get(CONNECTION_PORT_TOKEN);
    integrationsService = module.get(INTEGRATIONS_SERVICE_TOKEN);
    jobEnqueue = module.get(JOB_ENQUEUE_TOKEN);
    credentialRepository = module.get(INTEGRATION_CREDENTIAL_REPOSITORY_TOKEN);
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
      expect(credentialRepository.create).not.toHaveBeenCalled();
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

    it('should reject when neither credentials nor credentialsRef are provided', async () => {
      const rest: ConnectionCreateInput = { ...payload };
      delete rest.credentialsRef;
      await expect(service.create(rest)).rejects.toThrow(/Exactly one of/);
    });

    it('should persist credentials and store db: ref when credentials payload is provided', async () => {
      connectionPort.create.mockResolvedValue(mockConnection);

      await service.create({
        name: 'Wizard Connection',
        platformType: 'prestashop',
        config: { baseUrl: 'https://new.com' },
        credentials: { webserviceApiKey: 'SECRET123' },
      });

      expect(credentialRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          platformType: 'prestashop',
          credentialsJson: { webserviceApiKey: 'SECRET123' },
          ref: expect.any(String),
        })
      );
      const credentialCall = credentialRepository.create.mock.calls[0][0];
      expect(connectionPort.create).toHaveBeenCalledWith(
        expect.objectContaining({
          credentialsRef: `db:${credentialCall.ref}`,
        })
      );
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
      expect(credentialRepository.create).not.toHaveBeenCalled();
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

      expect(credentialRepository.create).toHaveBeenCalledTimes(1);
      const createdRef = credentialRepository.create.mock.calls[0][0].ref;
      expect(credentialRepository.delete).toHaveBeenCalledWith(createdRef);
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

      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
    });

    it('should not fail connection creation when bootstrap enqueue throws', async () => {
      connectionPort.create.mockResolvedValue(mockConnection);
      integrationsService.getAdapter.mockRejectedValue(new Error('adapter resolution failed'));

      await expect(service.create(payload)).resolves.toEqual(mockConnection);
      expect(jobEnqueue.enqueueJob).not.toHaveBeenCalled();
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

    it('should throw NotFoundException when connection not found', async () => {
      connectionPort.get.mockRejectedValue(new ConnectionNotFoundException('connection-123'));

      await expect(service.update('connection-123', { name: 'Updated' })).rejects.toThrow(
        NotFoundException
      );
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

      expect(credentialRepository.update).toHaveBeenCalledWith('cred-ref-1', {
        credentialsJson: { webserviceApiKey: 'NEW' },
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
      expect(credentialRepository.update).not.toHaveBeenCalled();
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

    it('should throw NotFoundException when connection not found', async () => {
      connectionPort.disable.mockRejectedValue(new ConnectionNotFoundException('connection-123'));

      await expect(service.disable('connection-123')).rejects.toThrow(NotFoundException);
    });
  });
});
