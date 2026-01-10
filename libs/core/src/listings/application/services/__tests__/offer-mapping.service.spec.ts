/**
 * Offer Mapping Service Tests
 *
 * Unit tests for OfferMappingService. Tests CRUD operations, validation,
 * and error handling.
 *
 * @module libs/core/src/listings/application/services/__tests__
 */
import { OfferMappingService } from '../offer-mapping.service';
import { OfferMappingRepositoryPort } from '../../../domain/ports/offer-mapping-repository.port';
import { OfferMapping } from '../../../domain/entities/offer-mapping.entity';
import { DuplicateOfferMappingError } from '../../../domain/exceptions/duplicate-offer-mapping.error';

describe('OfferMappingService', () => {
  let service: OfferMappingService;
  let repository: jest.Mocked<OfferMappingRepositoryPort>;

  beforeEach(() => {
    repository = {
      findById: jest.fn(),
      findByConnectionAndOffer: jest.fn(),
      findByProduct: jest.fn(),
      findByConnection: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<OfferMappingRepositoryPort>;

    service = new OfferMappingService(repository);
  });

  describe('create', () => {
    it('should create mapping successfully', async () => {
      const mapping = createMapping();
      repository.create.mockResolvedValue(mapping);

      const result = await service.create(
        'connection-id',
        'allegro',
        'offer-id',
        'product-id',
      );

      expect(result).toBe(mapping);
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionId: 'connection-id',
          platformType: 'allegro',
          offerId: 'offer-id',
          internalProductId: 'product-id',
        }),
      );
    });

    it('should propagate DuplicateOfferMappingError', async () => {
      repository.create.mockRejectedValue(
        new DuplicateOfferMappingError('connection-id', 'offer-id'),
      );

      await expect(
        service.create('connection-id', 'allegro', 'offer-id', 'product-id'),
      ).rejects.toThrow(DuplicateOfferMappingError);
    });
  });

  describe('findById', () => {
    it('should return mapping when found', async () => {
      const mapping = createMapping();
      repository.findById.mockResolvedValue(mapping);

      const result = await service.findById('mapping-id');

      expect(result).toBe(mapping);
    });

    it('should return null when not found', async () => {
      repository.findById.mockResolvedValue(null);

      const result = await service.findById('non-existent-id');

      expect(result).toBeNull();
    });
  });

  describe('findByConnectionAndOffer', () => {
    it('should return mapping when found', async () => {
      const mapping = createMapping();
      repository.findByConnectionAndOffer.mockResolvedValue(mapping);

      const result = await service.findByConnectionAndOffer('connection-id', 'offer-id');

      expect(result).toBe(mapping);
    });
  });

  describe('findByProduct', () => {
    it('should return all mappings for product', async () => {
      const mappings = [createMapping()];
      repository.findByProduct.mockResolvedValue(mappings);

      const result = await service.findByProduct('product-id');

      expect(result).toEqual(mappings);
    });
  });

  describe('findByConnection', () => {
    it('should return all mappings for connection', async () => {
      const mappings = [createMapping()];
      repository.findByConnection.mockResolvedValue(mappings);

      const result = await service.findByConnection('connection-id');

      expect(result).toEqual(mappings);
    });
  });

  describe('update', () => {
    it('should update mapping successfully', async () => {
      const existing = createMapping();
      const updated = { ...existing, internalProductId: 'new-product-id' };
      repository.findById.mockResolvedValue(existing);
      repository.update.mockResolvedValue(updated);

      const result = await service.update('mapping-id', {
        internalProductId: 'new-product-id',
      });

      expect(result).toBe(updated);
      expect(repository.update).toHaveBeenCalled();
    });

    it('should throw error if mapping not found', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.update('non-existent-id', { internalProductId: 'new-product-id' }),
      ).rejects.toThrow('Offer mapping not found');
    });

    it('should update variantId to null', async () => {
      const existing = createMapping();
      repository.findById.mockResolvedValue(existing);
      repository.update.mockResolvedValue({ ...existing, variantId: null });

      await service.update('mapping-id', { variantId: null });

      expect(repository.update).toHaveBeenCalledWith(
        expect.objectContaining({ variantId: null }),
      );
    });
  });

  describe('delete', () => {
    it('should delete mapping successfully', async () => {
      repository.delete.mockResolvedValue(undefined);

      await service.delete('mapping-id');

      expect(repository.delete).toHaveBeenCalledWith('mapping-id');
    });

    it('should propagate error if mapping not found', async () => {
      repository.delete.mockRejectedValue(new Error('Offer mapping not found'));

      await expect(service.delete('non-existent-id')).rejects.toThrow('Offer mapping not found');
    });
  });

  function createMapping(): OfferMapping {
    return new OfferMapping(
      'mapping-id',
      'connection-id',
      'allegro',
      'offer-id',
      'product-id',
      null,
      new Date(),
      new Date(),
    );
  }
});



