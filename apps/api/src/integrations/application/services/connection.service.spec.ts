/**
 * Connection Service Unit Tests
 *
 * Unit tests for ConnectionService, verifying API layer service
 * wrapper functionality and error handling.
 *
 * @module apps/api/src/integrations/application/services
 */
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ConnectionService } from './connection.service';
import {
  ConnectionPort,
  CONNECTION_PORT_TOKEN,
  Connection,
  ConnectionNotFoundException,
  ConnectionUpdate,
  ConnectionFilters,
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
  ConnectionTesterPort,
} from '@openlinker/core/integrations';
import { JobEnqueuePort, JOB_ENQUEUE_TOKEN } from '@openlinker/core/sync';
import { ConnectionCreateInput } from '../interfaces/connection.service.types';

describe('ConnectionService', () => {
  let service: ConnectionService;
  let connectionPort: jest.Mocked<ConnectionPort>;
  let integrationsService: jest.Mocked<IIntegrationsService>;
  let jobEnqueue: jest.Mocked<JobEnqueuePort>;
  let credentialRepository: jest.Mocked<IntegrationCredentialRepositoryPort>;
  let testerRegistry: ConnectionTesterRegistryService;
  let mockTester: jest.Mocked<ConnectionTesterPort>;

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
    ['ProductMaster', 'InventoryMaster', 'OrderSource', 'OrderProcessorManager', 'Marketplace'],
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
        supportedCapabilities: ['ProductMaster', 'InventoryMaster', 'OrderSource', 'OrderProcessorManager'],
      }),
    } as unknown as jest.Mocked<IIntegrationsService>;

    const mockJobEnqueue = {
      enqueueJob: jest.fn().mockResolvedValue({ jobId: 'job-1', isExisting: false }),
    } as unknown as jest.Mocked<JobEnqueuePort>;

    const mockCredentialRepository = {
      getByRef: jest.fn(),
      create: jest.fn().mockImplementation((payload: { ref: string; platformType: string; credentialsJson: Record<string, unknown> }) =>
        Promise.resolve({
          id: 'cred-row-1',
          ref: payload.ref,
          platformType: payload.platformType,
          credentialsJson: payload.credentialsJson,
          encrypted: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ),
      update: jest.fn(),
      delete: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<IntegrationCredentialRepositoryPort>;

    testerRegistry = new ConnectionTesterRegistryService();
    mockTester = { test: jest.fn() } as jest.Mocked<ConnectionTesterPort>;
    testerRegistry.register('prestashop.webservice.v1', mockTester);

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
        }),
      );
      expect(credentialRepository.create).not.toHaveBeenCalled();
    });

    it('should reject raw-key credentialsRef without db: prefix', async () => {
      await expect(
        service.create({ ...payload, credentialsRef: 'RAW_KEY_XYZ' }),
      ).rejects.toThrow(/must start with "db:"/);
      expect(connectionPort.create).not.toHaveBeenCalled();
    });

    it('should reject when both credentials and credentialsRef are provided', async () => {
      await expect(
        service.create({
          ...payload,
          credentials: { webserviceApiKey: 'X' },
        }),
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
        }),
      );
      const credentialCall = credentialRepository.create.mock.calls[0][0];
      expect(connectionPort.create).toHaveBeenCalledWith(
        expect.objectContaining({
          credentialsRef: `db:${credentialCall.ref}`,
        }),
      );
    });

    it('should reject PrestaShop credentials missing webserviceApiKey', async () => {
      await expect(
        service.create({
          name: 'Wizard Connection',
          platformType: 'prestashop',
          config: { baseUrl: 'https://new.com' },
          credentials: { someOtherField: 'X' },
        }),
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
        }),
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
        }),
      );
    });

    it('should skip enqueue when adapter does not support ProductMaster', async () => {
      connectionPort.create.mockResolvedValue(mockConnection);
      integrationsService.getAdapter.mockResolvedValue({
        connection: mockConnection,
        adapter: {},
        metadata: { supportedCapabilities: ['Marketplace'] },
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
      connectionPort.get.mockRejectedValue(
        new ConnectionNotFoundException('connection-123'),
      );

      await expect(service.get('connection-123')).rejects.toThrow(
        NotFoundException,
      );
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
        ['ProductMaster', 'InventoryMaster', 'OrderSource', 'OrderProcessorManager', 'Marketplace'],
      );

      connectionPort.get.mockResolvedValue(mockConnection);
      connectionPort.update.mockResolvedValue(updatedConnection);

      const result = await service.update('connection-123', patch);

      expect(result).toEqual(updatedConnection);
      expect(connectionPort.update).toHaveBeenCalledWith('connection-123', patch);
    });

    it('should throw NotFoundException when connection not found', async () => {
      connectionPort.get.mockRejectedValue(
        new ConnectionNotFoundException('connection-123'),
      );

      await expect(
        service.update('connection-123', { name: 'Updated' }),
      ).rejects.toThrow(NotFoundException);
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
        ['ProductMaster'],
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
        ['ProductMaster'],
      );
      connectionPort.get.mockResolvedValue(legacy);

      await expect(
        service.updateCredentials('connection-123', { webserviceApiKey: 'NEW' }),
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
        [],
      );
      connectionPort.get.mockResolvedValue(adapterLessConnection);
      integrationsService.resolveAdapterMetadata.mockResolvedValue({
        adapterKey: 'unknown.v1',
        platformType: 'unknown-platform',
        supportedCapabilities: [],
      });

      await expect(service.testConnection('connection-999')).rejects.toThrow(
        /not supported/,
      );
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
        ['ProductMaster', 'InventoryMaster', 'OrderSource', 'OrderProcessorManager', 'Marketplace'],
      );

      connectionPort.disable.mockResolvedValue(disabledConnection);

      const result = await service.disable('connection-123');

      expect(result.status).toBe('disabled');
      expect(connectionPort.disable).toHaveBeenCalledWith('connection-123');
    });

    it('should throw NotFoundException when connection not found', async () => {
      connectionPort.disable.mockRejectedValue(
        new ConnectionNotFoundException('connection-123'),
      );

      await expect(service.disable('connection-123')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});






