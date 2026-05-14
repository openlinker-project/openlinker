/**
 * Customer Identity Resolver Service Unit Tests
 *
 * Unit tests for CustomerIdentityResolverService, verifying identity resolution
 * modes, email fallback logic, collision handling, and mapping creation.
 *
 * @module libs/core/src/customers/application/services
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { Provider } from '@nestjs/common';
import { CustomerIdentityResolverService } from './customer-identity-resolver.service';
import type { ConnectionPort, IdentifierMappingPort } from '@openlinker/core/identifier-mapping';
import { CONNECTION_PORT_TOKEN } from '@openlinker/core/identifier-mapping';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import {
  EmailNormalizerRegistryService,
  EMAIL_NORMALIZER_REGISTRY_TOKEN,
  INTEGRATIONS_SERVICE_TOKEN,
} from '@openlinker/core/integrations';
import type { CustomerProjectionRepositoryPort } from '../../domain/ports/customer-projection-repository.port';
import type { CustomerIdentityResolutionRequest } from '../../domain/types/customer-identity.types';
import { CustomerProjection } from '../../domain/entities/customer-projection.entity';
import { IDENTIFIER_MAPPING_PORT_TOKEN } from '@openlinker/core/identifier-mapping';
import {
  CUSTOMER_PROJECTION_REPOSITORY_TOKEN,
  CUSTOMER_PROJECTION_SERVICE_TOKEN,
} from '../../customers.tokens';
import { DuplicateIdentifierMappingError } from '@openlinker/core/identifier-mapping';
import type { ICustomerProjectionService } from '../interfaces/customer-projection.service.interface';
import { hashEmail } from '@openlinker/shared/config';

describe('CustomerIdentityResolverService', () => {
  let service: CustomerIdentityResolverService;
  let identifierMapping: jest.Mocked<IdentifierMappingPort>;
  let projectionRepository: jest.Mocked<CustomerProjectionRepositoryPort>;
  let customerProjectionService: jest.Mocked<ICustomerProjectionService>;
  let connectionPort: jest.Mocked<ConnectionPort>;
  let integrationsService: jest.Mocked<Pick<IIntegrationsService, 'resolveAdapterMetadata'>>;
  let emailNormalizerRegistry: EmailNormalizerRegistryService;

  const originalEnv = process.env.OL_CUSTOMER_IDENTITY_MODE;
  const originalPiiHashSalt = process.env.OL_PII_HASH_SALT;

  // The adapterKey the IIntegrationsService mock returns for every
  // resolution — varied per-test when a specific platform is needed.
  let resolvedAdapterKey = 'test.adapter.v1';

  const buildProviders = (): Provider[] => [
    CustomerIdentityResolverService,
    { provide: IDENTIFIER_MAPPING_PORT_TOKEN, useValue: identifierMapping },
    { provide: CUSTOMER_PROJECTION_REPOSITORY_TOKEN, useValue: projectionRepository },
    { provide: CUSTOMER_PROJECTION_SERVICE_TOKEN, useValue: customerProjectionService },
    { provide: CONNECTION_PORT_TOKEN, useValue: connectionPort },
    { provide: INTEGRATIONS_SERVICE_TOKEN, useValue: integrationsService },
    { provide: EMAIL_NORMALIZER_REGISTRY_TOKEN, useValue: emailNormalizerRegistry },
  ];

  beforeEach(async () => {
    // Set required environment variable for PII config
    process.env.OL_PII_HASH_SALT = 'test-salt-for-hashing';

    identifierMapping = {
      getInternalId: jest.fn(),
      getOrCreateInternalId: jest.fn(),
      getExternalId: jest.fn(),
      createMapping: jest.fn(),
      getExternalIds: jest.fn(),
      batchGetOrCreateInternalIds: jest.fn(),
      getOrCreateExactMapping: jest.fn(),
      deleteMapping: jest.fn(),
      listExternalIdsByConnection: jest.fn(),
    } as unknown as jest.Mocked<IdentifierMappingPort>;

    projectionRepository = {
      findByEmailHash: jest.fn(),
      upsertProjection: jest.fn(),
      findDestinationAddressMapping: jest.fn(),
      upsertDestinationAddressMapping: jest.fn(),
    } as unknown as jest.Mocked<CustomerProjectionRepositoryPort>;

    customerProjectionService = {
      upsertProjection: jest.fn(),
      upsertAddressProjection: jest.fn(),
      upsertDestinationAddressMapping: jest.fn(),
    } as unknown as jest.Mocked<ICustomerProjectionService>;

    connectionPort = {
      get: jest.fn().mockResolvedValue({
        id: 'connection-123',
        platformType: 'allegro',
        adapterKey: undefined,
      }),
      list: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<ConnectionPort>;

    resolvedAdapterKey = 'test.adapter.v1';
    integrationsService = {
      resolveAdapterMetadata: jest.fn().mockImplementation(() =>
        Promise.resolve({
          adapterKey: resolvedAdapterKey,
          platformType: 'allegro',
          supportedCapabilities: [],
          displayName: 'Test Adapter',
          version: '1.0.0',
        })
      ),
    };

    // Real registry — small enough to instantiate directly; per-test setup
    // registers (or doesn't register) a normalizer to drive each branch.
    emailNormalizerRegistry = new EmailNormalizerRegistryService();

    const module: TestingModule = await Test.createTestingModule({
      providers: buildProviders(),
    }).compile();

    service = module.get<CustomerIdentityResolverService>(CustomerIdentityResolverService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    if (originalEnv) {
      process.env.OL_CUSTOMER_IDENTITY_MODE = originalEnv;
    } else {
      delete process.env.OL_CUSTOMER_IDENTITY_MODE;
    }
    if (originalPiiHashSalt) {
      process.env.OL_PII_HASH_SALT = originalPiiHashSalt;
    } else {
      delete process.env.OL_PII_HASH_SALT;
    }
  });

  describe('resolveCustomerIdentity - external_only mode', () => {
    beforeEach(async () => {
      process.env.OL_CUSTOMER_IDENTITY_MODE = 'external_only';
      // Recreate module to pick up new env var
      const module: TestingModule = await Test.createTestingModule({
        providers: buildProviders(),
      }).compile();
      service = module.get<CustomerIdentityResolverService>(CustomerIdentityResolverService);
    });

    it('should resolve via external mapping when mapping exists', async () => {
      const request: CustomerIdentityResolutionRequest = {
        externalBuyerId: 'allegro-buyer-123',
        email: 'buyer@example.com',
        sourceConnectionId: 'connection-123',
      };

      identifierMapping.getInternalId.mockResolvedValue('internal-customer-456');

      const result = await service.resolveCustomerIdentity(request);

      expect(result.internalCustomerId).toBe('internal-customer-456');
      expect(result.usedEmailFallback).toBe(false);
      expect(result.collisionDetected).toBe(false);
      expect(identifierMapping.getInternalId).toHaveBeenCalledWith(
        'Customer',
        'allegro-buyer-123',
        'connection-123'
      );
      expect(projectionRepository.findByEmailHash).not.toHaveBeenCalled();
    });

    it('should create new customer when external mapping not found', async () => {
      const request: CustomerIdentityResolutionRequest = {
        externalBuyerId: 'allegro-buyer-123',
        email: 'buyer@example.com',
        sourceConnectionId: 'connection-123',
      };

      identifierMapping.getInternalId.mockResolvedValue(null);
      identifierMapping.getOrCreateInternalId.mockResolvedValue('internal-customer-789');

      const result = await service.resolveCustomerIdentity(request);

      expect(result.internalCustomerId).toBe('internal-customer-789');
      expect(result.usedEmailFallback).toBe(false);
      expect(result.collisionDetected).toBe(false);
      expect(identifierMapping.getOrCreateInternalId).toHaveBeenCalledWith(
        'Customer',
        'allegro-buyer-123',
        'connection-123'
      );
      expect(projectionRepository.findByEmailHash).not.toHaveBeenCalled();
    });
  });

  describe('resolveCustomerIdentity - email_fallback mode', () => {
    beforeEach(async () => {
      process.env.OL_CUSTOMER_IDENTITY_MODE = 'email_fallback';
      // Recreate module to pick up new env var
      const module: TestingModule = await Test.createTestingModule({
        providers: buildProviders(),
      }).compile();
      service = module.get<CustomerIdentityResolverService>(CustomerIdentityResolverService);
    });

    it('should resolve via external mapping when mapping exists', async () => {
      const request: CustomerIdentityResolutionRequest = {
        externalBuyerId: 'allegro-buyer-123',
        email: 'buyer@example.com',
        sourceConnectionId: 'connection-123',
      };

      identifierMapping.getInternalId.mockResolvedValue('internal-customer-456');

      const result = await service.resolveCustomerIdentity(request);

      expect(result.internalCustomerId).toBe('internal-customer-456');
      expect(result.usedEmailFallback).toBe(false);
      expect(projectionRepository.findByEmailHash).not.toHaveBeenCalled();
    });

    it('should use email fallback when external mapping not found', async () => {
      const request: CustomerIdentityResolutionRequest = {
        externalBuyerId: 'allegro-buyer-123',
        email: 'buyer@example.com',
        sourceConnectionId: 'connection-123',
      };

      identifierMapping.getInternalId.mockResolvedValue(null);
      // Mock email hash lookup - find single customer
      const emailHash = 'hash123';
      const existingProjection = new CustomerProjection(
        'internal-customer-999',
        emailHash,
        'buyer@example.com',
        'John',
        'Doe',
        new Date(),
        'connection-456',
        new Date(),
        new Date()
      );
      projectionRepository.findByEmailHash.mockResolvedValue([existingProjection]);
      identifierMapping.createMapping.mockResolvedValue(undefined);

      const result = await service.resolveCustomerIdentity(request);

      expect(result.internalCustomerId).toBe('internal-customer-999');
      expect(result.usedEmailFallback).toBe(true);
      expect(result.collisionDetected).toBe(false);
      expect(projectionRepository.findByEmailHash).toHaveBeenCalled();
      // Should create mapping for new external buyer ID to existing internal customer
      expect(identifierMapping.createMapping).toHaveBeenCalledWith(
        'Customer',
        'allegro-buyer-123',
        'connection-123',
        'internal-customer-999'
      );
      expect(identifierMapping.getOrCreateInternalId).not.toHaveBeenCalled();
    });

    it('should handle createMapping error when mapping already exists (concurrent request)', async () => {
      const request: CustomerIdentityResolutionRequest = {
        externalBuyerId: 'allegro-buyer-123',
        email: 'buyer@example.com',
        sourceConnectionId: 'connection-123',
      };

      identifierMapping.getInternalId.mockResolvedValue(null);
      const emailHash = 'hash123';
      const existingProjection = new CustomerProjection(
        'internal-customer-999',
        emailHash,
        'buyer@example.com',
        'John',
        'Doe',
        new Date(),
        'connection-456',
        new Date(),
        new Date()
      );
      projectionRepository.findByEmailHash.mockResolvedValue([existingProjection]);
      // Simulate concurrent mapping creation - duplicate error
      identifierMapping.createMapping.mockRejectedValue(
        new DuplicateIdentifierMappingError(
          'Customer',
          'allegro-buyer-123',
          'allegro',
          'connection-123'
        )
      );
      identifierMapping.getInternalId
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('internal-customer-999');

      const result = await service.resolveCustomerIdentity(request);

      expect(result.internalCustomerId).toBe('internal-customer-999');
      expect(result.usedEmailFallback).toBe(true);
      expect(result.collisionDetected).toBe(false);
      // Should retry getInternalId after createMapping fails
      expect(identifierMapping.getInternalId).toHaveBeenCalledTimes(2);
    });

    it('should handle collision when multiple customers match email hash', async () => {
      const request: CustomerIdentityResolutionRequest = {
        externalBuyerId: 'allegro-buyer-123',
        email: 'shared@example.com',
        sourceConnectionId: 'connection-123',
      };

      identifierMapping.getInternalId.mockResolvedValue(null);
      // Mock email hash lookup - find multiple customers (collision)
      const emailHash = 'hash456';
      const projection1 = new CustomerProjection(
        'internal-customer-1',
        emailHash,
        'shared@example.com',
        'John',
        'Doe',
        new Date(),
        'connection-1',
        new Date(),
        new Date()
      );
      const projection2 = new CustomerProjection(
        'internal-customer-2',
        emailHash,
        'shared@example.com',
        'Jane',
        'Smith',
        new Date(),
        'connection-2',
        new Date(),
        new Date()
      );
      projectionRepository.findByEmailHash.mockResolvedValue([projection1, projection2]);
      identifierMapping.getOrCreateInternalId.mockResolvedValue('internal-customer-new');

      const result = await service.resolveCustomerIdentity(request);

      expect(result.internalCustomerId).toBe('internal-customer-new');
      expect(result.usedEmailFallback).toBe(true);
      expect(result.collisionDetected).toBe(true);
      // Should create new customer instead of using existing ones
      expect(identifierMapping.getOrCreateInternalId).toHaveBeenCalled();
      expect(identifierMapping.createMapping).not.toHaveBeenCalled();
    });

    it('should create new customer when email fallback finds no matches', async () => {
      const request: CustomerIdentityResolutionRequest = {
        externalBuyerId: 'allegro-buyer-123',
        email: 'newbuyer@example.com',
        sourceConnectionId: 'connection-123',
      };

      identifierMapping.getInternalId.mockResolvedValue(null);
      projectionRepository.findByEmailHash.mockResolvedValue([]);
      identifierMapping.getOrCreateInternalId.mockResolvedValue('internal-customer-new');

      const result = await service.resolveCustomerIdentity(request);

      expect(result.internalCustomerId).toBe('internal-customer-new');
      expect(result.usedEmailFallback).toBe(true);
      expect(result.collisionDetected).toBe(false);
    });
  });

  describe('Email normalization dispatch (#585 / E5)', () => {
    beforeEach(async () => {
      process.env.OL_CUSTOMER_IDENTITY_MODE = 'email_fallback';
      // Recreate module to pick up new env var
      const module: TestingModule = await Test.createTestingModule({
        providers: buildProviders(),
      }).compile();
      service = module.get<CustomerIdentityResolverService>(CustomerIdentityResolverService);
    });

    it('should apply the Allegro-registered normalizer to strip +transactionId before hashing', async () => {
      // Wire the source connection's adapterKey to 'allegro.publicapi.v1'
      // and register a stub normalizer with the same strip-on-allegromail
      // contract the real AllegroEmailNormalizerAdapter implements. The
      // assertion is that the resolver *dispatches through the registry*
      // — that proves CORE no longer hardcodes the platform.
      resolvedAdapterKey = 'allegro.publicapi.v1';
      emailNormalizerRegistry.register('allegro.publicapi.v1', {
        normalize: (email: string) => {
          const trimmed = email.trim().toLowerCase();
          if (!trimmed.includes('@allegromail.')) return trimmed;
          const [local, domain] = trimmed.split('@');
          return local.includes('+') ? `${local.split('+')[0]}@${domain}` : trimmed;
        },
      });

      const request: CustomerIdentityResolutionRequest = {
        externalBuyerId: 'allegro-buyer-123',
        email: '8awgqyk6a5+cub31c122@allegromail.pl',
        sourceConnectionId: 'connection-123',
      };

      identifierMapping.getInternalId.mockResolvedValue(null);
      projectionRepository.findByEmailHash.mockResolvedValue([]);
      identifierMapping.getOrCreateInternalId.mockResolvedValue('internal-customer-new');

      // Expected hash = hash of the *normalized* (stripped) email.
      const expectedHash = hashEmail('8awgqyk6a5@allegromail.pl');

      await service.resolveCustomerIdentity(request);

      expect(projectionRepository.findByEmailHash).toHaveBeenCalledWith(expectedHash);
      expect(integrationsService.resolveAdapterMetadata).toHaveBeenCalledWith({
        platformType: 'allegro',
        adapterKey: undefined,
      });
    });

    it('should fall back to the baseline normalizer when no per-adapter normalizer is registered', async () => {
      // This is the load-bearing test for the modularity fix: when no
      // platform-specific normalizer is registered for the resolved
      // adapterKey, the resolver must apply only the shared trim+lowercase
      // baseline — masked emails go through unchanged, which proves CORE
      // is platform-clean.
      resolvedAdapterKey = 'unregistered.adapter.v1';
      // (no registry.register() call — registry is empty)

      const request: CustomerIdentityResolutionRequest = {
        externalBuyerId: 'allegro-buyer-123',
        email: '8awgqyk6a5+cub31c122@allegromail.pl',
        sourceConnectionId: 'connection-123',
      };

      identifierMapping.getInternalId.mockResolvedValue(null);
      projectionRepository.findByEmailHash.mockResolvedValue([]);
      identifierMapping.getOrCreateInternalId.mockResolvedValue('internal-customer-new');

      // Expected hash = hash of the *un-stripped* email (+transactionId kept).
      const expectedHash = hashEmail('8awgqyk6a5+cub31c122@allegromail.pl');

      await service.resolveCustomerIdentity(request);

      expect(projectionRepository.findByEmailHash).toHaveBeenCalledWith(expectedHash);
    });

    it('should handle empty email gracefully', async () => {
      const request: CustomerIdentityResolutionRequest = {
        externalBuyerId: 'allegro-buyer-123',
        email: '',
        sourceConnectionId: 'connection-123',
      };

      identifierMapping.getInternalId.mockResolvedValue(null);
      projectionRepository.findByEmailHash.mockResolvedValue([]);
      identifierMapping.getOrCreateInternalId.mockResolvedValue('internal-customer-new');

      const result = await service.resolveCustomerIdentity(request);

      // Should still work (email fallback will hash empty string)
      expect(result.internalCustomerId).toBe('internal-customer-new');
      expect(result.usedEmailFallback).toBe(true);
    });
  });
});
