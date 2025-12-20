/**
 * Identifier Mapping Service Unit Tests
 *
 * Unit tests for IdentifierMappingService, verifying identifier mapping
 * operations including get-or-create semantics and bidirectional mapping.
 *
 * @module libs/core/src/identifier-mapping/application/services
 */
import { IdentifierMappingService } from './identifier-mapping.service';
import { IdentifierMappingRepository } from '../../infrastructure/persistence/repositories/identifier-mapping.repository';
import { IdentifierMapping } from '../../domain/entities/identifier-mapping.entity';

describe('IdentifierMappingService', () => {
  let service: IdentifierMappingService;
  let repository: jest.Mocked<IdentifierMappingRepository>;

  beforeEach(() => {
    const mockRepository = {
      findByExternalId: jest.fn(),
      findByInternalId: jest.fn(),
      create: jest.fn(),
    } as unknown as jest.Mocked<IdentifierMappingRepository>;

    service = new IdentifierMappingService(mockRepository);
    repository = mockRepository;
  });

  describe('getOrCreateInternalId', () => {
    it('should return existing internal ID if mapping exists', async () => {
      const existingMapping = new IdentifierMapping(
        'id-1',
        'Product',
        'ol_product_abc123',
        'external-123',
        'prestashop',
        null,
        new Date(),
        new Date(),
      );

      repository.findByExternalId.mockResolvedValue(existingMapping);

      const result = await service.getOrCreateInternalId(
        'Product',
        'external-123',
        'prestashop',
      );

      expect(result).toBe('ol_product_abc123');
      expect(repository.findByExternalId).toHaveBeenCalledWith(
        'Product',
        'external-123',
        'prestashop',
      );
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('should create new mapping if it does not exist', async () => {
      repository.findByExternalId.mockResolvedValue(null);
      repository.create.mockResolvedValue(
        new IdentifierMapping(
          'id-1',
          'Product',
          'ol_product_new123',
          'external-123',
          'prestashop',
          null,
          new Date(),
          new Date(),
        ),
      );

      const result = await service.getOrCreateInternalId(
        'Product',
        'external-123',
        'prestashop',
      );

      expect(result).toMatch(/^ol_product_/);
      expect(repository.create).toHaveBeenCalled();
    });
  });

  describe('getInternalId', () => {
    it('should return internal ID if mapping exists', async () => {
      const mapping = new IdentifierMapping(
        'id-1',
        'Product',
        'ol_product_abc123',
        'external-123',
        'prestashop',
        null,
        new Date(),
        new Date(),
      );

      repository.findByExternalId.mockResolvedValue(mapping);

      const result = await service.getInternalId('Product', 'external-123', 'prestashop');

      expect(result).toBe('ol_product_abc123');
    });

    it('should return null if mapping does not exist', async () => {
      repository.findByExternalId.mockResolvedValue(null);

      const result = await service.getInternalId('Product', 'external-123', 'prestashop');

      expect(result).toBeNull();
    });
  });
});
