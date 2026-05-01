/**
 * Customer Projection Service Unit Tests
 *
 * Unit tests for CustomerProjectionService, verifying PII toggle logic,
 * projection upsert, and address projection handling.
 *
 * @module libs/core/src/customers/application/services
 */
import { Test, TestingModule } from '@nestjs/testing';
import { CustomerProjectionService } from './customer-projection.service';
import { CustomerProjectionRepositoryPort } from '../../domain/ports/customer-projection-repository.port';
import { CustomerProjection } from '../../domain/entities/customer-projection.entity';
import { CustomerAddressProjection } from '../../domain/entities/customer-address-projection.entity';
import { DestinationAddressMapping } from '../../domain/entities/destination-address-mapping.entity';
import { CUSTOMER_PROJECTION_REPOSITORY_TOKEN } from '../../customers.tokens';

describe('CustomerProjectionService', () => {
  let service: CustomerProjectionService;
  let repository: jest.Mocked<CustomerProjectionRepositoryPort>;

  const originalEnv = process.env.OL_STORE_PII;
  const originalPiiHashSalt = process.env.OL_PII_HASH_SALT;

  beforeEach(async () => {
    // Set required environment variable for PII config
    process.env.OL_PII_HASH_SALT = 'test-salt-for-hashing';
    repository = {
      upsert: jest.fn(),
      upsertAddress: jest.fn(),
      upsertDestinationAddressMapping: jest.fn(),
      findById: jest.fn(),
      findByEmailHash: jest.fn(),
      findDestinationAddressMapping: jest.fn(),
    } as unknown as jest.Mocked<CustomerProjectionRepositoryPort>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustomerProjectionService,
        {
          provide: CUSTOMER_PROJECTION_REPOSITORY_TOKEN,
          useValue: repository,
        },
      ],
    }).compile();

    service = module.get<CustomerProjectionService>(CustomerProjectionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    if (originalEnv) {
      process.env.OL_STORE_PII = originalEnv;
    } else {
      delete process.env.OL_STORE_PII;
    }
    if (originalPiiHashSalt) {
      process.env.OL_PII_HASH_SALT = originalPiiHashSalt;
    } else {
      delete process.env.OL_PII_HASH_SALT;
    }
  });

  describe('getProjection', () => {
    it('should return the domain projection when the repository finds a row', async () => {
      const projection = new CustomerProjection(
        'internal-customer-123',
        'emailHash123',
        'customer@example.com',
        'John',
        'Doe',
        new Date(),
        'connection-456',
        new Date(),
        new Date(),
      );
      repository.findById.mockResolvedValue(projection);

      const result = await service.getProjection('internal-customer-123');

      expect(result).toBe(projection);
      expect(repository.findById).toHaveBeenCalledWith('internal-customer-123');
    });

    it('should return null when no projection exists', async () => {
      repository.findById.mockResolvedValue(null);

      const result = await service.getProjection('internal-customer-missing');

      expect(result).toBeNull();
      expect(repository.findById).toHaveBeenCalledWith('internal-customer-missing');
    });
  });

  describe('upsertProjection - PII enabled', () => {
    beforeEach(() => {
      process.env.OL_STORE_PII = 'true';
      // Recreate service to pick up new env var
      service = new CustomerProjectionService(repository);
    });

    it('should save projection with all PII fields when PII storage is enabled', async () => {
      const projection = new CustomerProjection(
        'internal-customer-123',
        'emailHash123',
        'customer@example.com',
        'John',
        'Doe',
        new Date(),
        'connection-456',
        new Date(),
        new Date(),
      );

      repository.upsert.mockResolvedValue(projection);

      const result = await service.upsertProjection(projection);

      expect(result).toBe(projection);
      expect(repository.upsert).toHaveBeenCalledWith(projection);
      // Verify PII fields are preserved
      expect(repository.upsert.mock.calls[0][0].normalizedEmail).toBe('customer@example.com');
      expect(repository.upsert.mock.calls[0][0].firstName).toBe('John');
      expect(repository.upsert.mock.calls[0][0].lastName).toBe('Doe');
    });
  });

  describe('upsertProjection - PII disabled', () => {
    beforeEach(() => {
      process.env.OL_STORE_PII = 'false';
      service = new CustomerProjectionService(repository);
    });

    it('should clear PII fields but keep emailHash when PII storage is disabled', async () => {
      const projection = new CustomerProjection(
        'internal-customer-123',
        'emailHash123',
        'customer@example.com',
        'John',
        'Doe',
        new Date(),
        'connection-456',
        new Date(),
        new Date(),
      );

      const savedProjection = new CustomerProjection(
        'internal-customer-123',
        'emailHash123',
        null,
        null,
        null,
        new Date(),
        'connection-456',
        new Date(),
        new Date(),
      );

      repository.upsert.mockResolvedValue(savedProjection);

      const result = await service.upsertProjection(projection);

      expect(result).toBe(savedProjection);
      expect(repository.upsert).toHaveBeenCalled();
      const saved = repository.upsert.mock.calls[0][0];
      expect(saved.emailHash).toBe('emailHash123'); // emailHash always persisted
      expect(saved.normalizedEmail).toBeNull();
      expect(saved.firstName).toBeNull();
      expect(saved.lastName).toBeNull();
    });
  });

  describe('upsertAddressProjection - PII enabled', () => {
    beforeEach(() => {
      process.env.OL_STORE_PII = 'true';
      service = new CustomerProjectionService(repository);
    });

    it('should save address projection with all PII fields when PII storage is enabled', async () => {
      const address = new CustomerAddressProjection(
        'internal-customer-123',
        'addressHash123',
        'shipping',
        '123 Main St',
        'Apt 4',
        'Warsaw',
        '00-001',
        'PL',
        new Date(),
        new Date(),
        new Date(),
      );

      repository.upsertAddress.mockResolvedValue(address);

      const result = await service.upsertAddressProjection(address);

      expect(result).toBe(address);
      expect(repository.upsertAddress).toHaveBeenCalledWith(address);
      // Verify PII fields are preserved
      const saved = repository.upsertAddress.mock.calls[0][0];
      expect(saved.address1).toBe('123 Main St');
      expect(saved.city).toBe('Warsaw');
    });
  });

  describe('upsertAddressProjection - PII disabled', () => {
    beforeEach(() => {
      process.env.OL_STORE_PII = 'false';
      service = new CustomerProjectionService(repository);
    });

    it('should clear PII fields but keep addressHash when PII storage is disabled', async () => {
      const address = new CustomerAddressProjection(
        'internal-customer-123',
        'addressHash123',
        'shipping',
        '123 Main St',
        'Apt 4',
        'Warsaw',
        '00-001',
        'PL',
        new Date(),
        new Date(),
        new Date(),
      );

      const savedAddress = new CustomerAddressProjection(
        'internal-customer-123',
        'addressHash123',
        'shipping',
        null,
        null,
        null,
        null,
        null,
        new Date(),
        new Date(),
        new Date(),
      );

      repository.upsertAddress.mockResolvedValue(savedAddress);

      const result = await service.upsertAddressProjection(address);

      expect(result).toBe(savedAddress);
      expect(repository.upsertAddress).toHaveBeenCalled();
      const saved = repository.upsertAddress.mock.calls[0][0];
      expect(saved.addressHash).toBe('addressHash123'); // addressHash always persisted
      expect(saved.address1).toBeNull();
      expect(saved.city).toBeNull();
    });
  });

  describe('upsertDestinationAddressMapping', () => {
    it('should save destination address mapping without PII filtering', async () => {
      const mapping = new DestinationAddressMapping(
        'internal-customer-123',
        'connection-456',
        'addressHash123',
        'shipping',
        'prestashop-address-789',
        new Date(),
        new Date(),
      );

      repository.upsertDestinationAddressMapping.mockResolvedValue(mapping);

      const result = await service.upsertDestinationAddressMapping(mapping);

      expect(result).toBe(mapping);
      expect(repository.upsertDestinationAddressMapping).toHaveBeenCalledWith(mapping);
      // Destination address mapping doesn't contain PII, so no filtering should occur
    });
  });
});
