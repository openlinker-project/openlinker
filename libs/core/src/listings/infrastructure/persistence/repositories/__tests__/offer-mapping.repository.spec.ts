/**
 * Offer Mapping Repository Tests
 *
 * Unit tests for OfferMappingRepository. Tests CRUD operations, duplicate
 * handling, and error cases.
 *
 * @module libs/core/src/listings/infrastructure/persistence/repositories/__tests__
 */
import { Repository, QueryFailedError } from 'typeorm';
import { OfferMappingRepository } from '../offer-mapping.repository';
import { OfferMappingOrmEntity } from '../../entities/offer-mapping.orm-entity';
import { OfferMapping } from '@openlinker/core/listings/domain/entities/offer-mapping.entity';
import { DuplicateOfferMappingError } from '@openlinker/core/listings/domain/exceptions/duplicate-offer-mapping.error';

describe('OfferMappingRepository', () => {
  let repository: OfferMappingRepository;
  let ormRepository: jest.Mocked<Repository<OfferMappingOrmEntity>>;

  beforeEach(() => {
    ormRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<Repository<OfferMappingOrmEntity>>;

    repository = new OfferMappingRepository(ormRepository);
  });

  describe('findById', () => {
    it('should return mapping when found', async () => {
      const entity = createOrmEntity();
      ormRepository.findOne.mockResolvedValue(entity);

      const result = await repository.findById('mapping-id');

      expect(result).toBeDefined();
      expect(result?.id).toBe(entity.id);
      expect(result?.connectionId).toBe(entity.connectionId);
      expect(result?.offerId).toBe(entity.offerId);
    });

    it('should return null when not found', async () => {
      ormRepository.findOne.mockResolvedValue(null);

      const result = await repository.findById('non-existent-id');

      expect(result).toBeNull();
    });
  });

  describe('findByConnectionAndOffer', () => {
    it('should return mapping when found', async () => {
      const entity = createOrmEntity();
      ormRepository.findOne.mockResolvedValue(entity);

      const result = await repository.findByConnectionAndOffer('connection-id', 'offer-id');

      expect(result).toBeDefined();
      expect(ormRepository.findOne).toHaveBeenCalledWith({
        where: { connectionId: 'connection-id', offerId: 'offer-id' },
      });
    });

    it('should return null when not found', async () => {
      ormRepository.findOne.mockResolvedValue(null);

      const result = await repository.findByConnectionAndOffer('connection-id', 'offer-id');

      expect(result).toBeNull();
    });
  });

  describe('findByProduct', () => {
    it('should return all mappings for product', async () => {
      const entities = [createOrmEntity(), createOrmEntity()];
      ormRepository.find.mockResolvedValue(entities);

      const result = await repository.findByProduct('product-id');

      expect(result).toHaveLength(2);
      expect(ormRepository.find).toHaveBeenCalledWith({
        where: { internalProductId: 'product-id' },
      });
    });

    it('should return empty array when no mappings found', async () => {
      ormRepository.find.mockResolvedValue([]);

      const result = await repository.findByProduct('product-id');

      expect(result).toEqual([]);
    });
  });

  describe('findByConnection', () => {
    it('should return all mappings for connection', async () => {
      const entities = [createOrmEntity()];
      ormRepository.find.mockResolvedValue(entities);

      const result = await repository.findByConnection('connection-id');

      expect(result).toHaveLength(1);
      expect(ormRepository.find).toHaveBeenCalledWith({
        where: { connectionId: 'connection-id' },
      });
    });
  });

  describe('create', () => {
    it('should create mapping successfully', async () => {
      const mapping = OfferMapping.create(
        'connection-id',
        'allegro',
        'offer-id',
        'product-id',
      );
      const savedEntity = createOrmEntity();
      ormRepository.save.mockResolvedValue(savedEntity);

      const result = await repository.create(mapping);

      expect(result).toBeDefined();
      expect(result.id).toBe(savedEntity.id);
      expect(ormRepository.save).toHaveBeenCalled();
    });

    it('should throw DuplicateOfferMappingError on unique constraint violation', async () => {
      const mapping = OfferMapping.create(
        'connection-id',
        'allegro',
        'offer-id',
        'product-id',
      );
      const error = new QueryFailedError('', [], 'duplicate key value violates unique constraint');
      ormRepository.save.mockRejectedValue(error);

      await expect(repository.create(mapping)).rejects.toThrow(DuplicateOfferMappingError);
    });

    it('should re-throw non-unique constraint errors', async () => {
      const mapping = OfferMapping.create(
        'connection-id',
        'allegro',
        'offer-id',
        'product-id',
      );
      const error = new Error('Database connection failed');
      ormRepository.save.mockRejectedValue(error);

      await expect(repository.create(mapping)).rejects.toThrow('Database connection failed');
    });
  });

  describe('update', () => {
    it('should update mapping successfully', async () => {
      const existing = createOrmEntity();
      const mapping = new OfferMapping(
        existing.id,
        existing.connectionId,
        existing.platformType,
        existing.offerId,
        'new-product-id',
        existing.variantId,
        existing.createdAt,
        new Date(),
      );
      ormRepository.findOne.mockResolvedValue(existing);
      ormRepository.save.mockResolvedValue({ ...existing, internalProductId: 'new-product-id' });

      const result = await repository.update(mapping);

      expect(result).toBeDefined();
      expect(ormRepository.save).toHaveBeenCalled();
    });

    it('should throw error if mapping not found', async () => {
      const mapping = new OfferMapping(
        'mapping-id',
        'connection-id',
        'allegro',
        'offer-id',
        'product-id',
        null,
        new Date(),
        new Date(),
      );
      ormRepository.findOne.mockResolvedValue(null);

      await expect(repository.update(mapping)).rejects.toThrow('Offer mapping not found');
    });

    it('should throw error if mapping has no ID', async () => {
      const mapping = new OfferMapping(
        '',
        'connection-id',
        'allegro',
        'offer-id',
        'product-id',
        null,
        new Date(),
        new Date(),
      );

      await expect(repository.update(mapping)).rejects.toThrow('Cannot update offer mapping without ID');
    });
  });

  describe('delete', () => {
    it('should delete mapping successfully', async () => {
      ormRepository.delete.mockResolvedValue({ affected: 1, raw: [] });

      await repository.delete('mapping-id');

      expect(ormRepository.delete).toHaveBeenCalledWith('mapping-id');
    });

    it('should throw error if mapping not found', async () => {
      ormRepository.delete.mockResolvedValue({ affected: 0, raw: [] });

      await expect(repository.delete('non-existent-id')).rejects.toThrow('Offer mapping not found');
    });
  });

  function createOrmEntity(): OfferMappingOrmEntity {
    const entity = new OfferMappingOrmEntity();
    entity.id = 'mapping-id';
    entity.connectionId = 'connection-id';
    entity.platformType = 'allegro';
    entity.offerId = 'offer-id';
    entity.internalProductId = 'product-id';
    entity.variantId = null;
    entity.createdAt = new Date();
    entity.updatedAt = new Date();
    return entity;
  }
});



