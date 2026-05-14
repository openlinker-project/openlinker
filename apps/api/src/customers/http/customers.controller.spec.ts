/**
 * Customers Controller Unit Tests
 *
 * @module apps/api/src/customers/http
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import type { CustomerProjectionRepositoryPort } from '@openlinker/core/customers';
import {
  CUSTOMER_PROJECTION_REPOSITORY_TOKEN,
  CustomerProjection,
  CustomerAddressProjection,
} from '@openlinker/core/customers';

describe('CustomersController', () => {
  let controller: CustomersController;
  let repository: jest.Mocked<CustomerProjectionRepositoryPort>;

  const mockCustomer = new CustomerProjection(
    'ol_customer_abc123',
    'hash123',
    'test@example.com',
    'John',
    'Doe',
    new Date('2026-01-01T00:00:00Z'),
    'conn-1',
    new Date('2026-01-01T00:00:00Z'),
    new Date('2026-01-01T00:00:00Z')
  );

  const mockAddress = new CustomerAddressProjection(
    'ol_customer_abc123',
    'addr_hash_1',
    'shipping',
    '123 Main St',
    null,
    'Warsaw',
    '00-001',
    'PL',
    new Date('2026-01-01T00:00:00Z'),
    new Date('2026-01-01T00:00:00Z'),
    new Date('2026-01-01T00:00:00Z')
  );

  beforeEach(async () => {
    const mockRepository: jest.Mocked<CustomerProjectionRepositoryPort> = {
      findById: jest.fn(),
      findByEmailHash: jest.fn(),
      findMany: jest.fn(),
      upsert: jest.fn(),
      findAddressesByCustomerId: jest.fn(),
      upsertAddress: jest.fn(),
      findDestinationAddressMapping: jest.fn(),
      upsertDestinationAddressMapping: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CustomersController],
      providers: [
        {
          provide: CUSTOMER_PROJECTION_REPOSITORY_TOKEN,
          useValue: mockRepository,
        },
      ],
    }).compile();

    controller = module.get<CustomersController>(CustomersController);
    repository = module.get(CUSTOMER_PROJECTION_REPOSITORY_TOKEN);
  });

  describe('listCustomers', () => {
    it('should return paginated customers with default pagination', async () => {
      repository.findMany.mockResolvedValue({ items: [mockCustomer], total: 1 });

      const result = await controller.listCustomers({});

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
      expect(repository.findMany).toHaveBeenCalledWith(
        { search: undefined, lastSourceConnectionId: undefined },
        { limit: 20, offset: 0 }
      );
    });

    it('should pass filters to repository', async () => {
      repository.findMany.mockResolvedValue({ items: [], total: 0 });

      await controller.listCustomers({
        search: 'test',
        lastSourceConnectionId: 'conn-1',
        limit: 10,
        offset: 5,
      });

      expect(repository.findMany).toHaveBeenCalledWith(
        { search: 'test', lastSourceConnectionId: 'conn-1' },
        { limit: 10, offset: 5 }
      );
    });

    it('should serialize dates as ISO 8601 strings', async () => {
      repository.findMany.mockResolvedValue({ items: [mockCustomer], total: 1 });

      const result = await controller.listCustomers({});

      expect(result.items[0].lastSeenAt).toBe('2026-01-01T00:00:00.000Z');
      expect(result.items[0].createdAt).toBe('2026-01-01T00:00:00.000Z');
    });
  });

  describe('getCustomer', () => {
    it('should return customer with addresses when found', async () => {
      repository.findById.mockResolvedValue(mockCustomer);
      repository.findAddressesByCustomerId.mockResolvedValue([mockAddress]);

      const result = await controller.getCustomer('ol_customer_abc123');

      expect(result.internalCustomerId).toBe('ol_customer_abc123');
      expect(result.addresses).toHaveLength(1);
      expect(result.addresses![0].addressType).toBe('shipping');
      expect(result.addresses![0].city).toBe('Warsaw');
    });

    it('should throw NotFoundException when customer not found', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(controller.getCustomer('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });
});
