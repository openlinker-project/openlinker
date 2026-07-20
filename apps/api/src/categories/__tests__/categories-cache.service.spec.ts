/**
 * CategoriesCacheService unit tests
 *
 * @module apps/api/src/categories/__tests__
 */

import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CategoriesCacheService } from '../categories-cache.service';
import { AllegroCategoryCacheOrmEntity } from '../persistence/allegro-category-cache.orm-entity';
import { INTEGRATIONS_SERVICE_TOKEN } from '@openlinker/core/integrations';
import type { OfferCategory } from '@openlinker/core/listings';

const CONNECTION_ID = 'conn-uuid-1';

function createMockCategory(
  overrides: Partial<AllegroCategoryCacheOrmEntity> = {}
): AllegroCategoryCacheOrmEntity {
  const entity = new AllegroCategoryCacheOrmEntity();
  entity.id = 'cache-id-1';
  entity.connectionId = CONNECTION_ID;
  entity.allegroCategoryId = '100';
  entity.name = 'Electronics';
  entity.parentId = null;
  entity.leaf = false;
  entity.fetchedAt = new Date();
  return Object.assign(entity, overrides);
}

describe('CategoriesCacheService', () => {
  let service: CategoriesCacheService;
  let cacheRepo: {
    find: jest.Mock;
    delete: jest.Mock;
    upsert: jest.Mock;
  };
  let integrationsService: { getCapabilityAdapter: jest.Mock };

  beforeEach(async () => {
    cacheRepo = {
      find: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue(undefined),
      upsert: jest.fn().mockResolvedValue(undefined),
    };

    integrationsService = {
      getCapabilityAdapter: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesCacheService,
        {
          provide: getRepositoryToken(AllegroCategoryCacheOrmEntity),
          useValue: cacheRepo,
        },
        {
          provide: INTEGRATIONS_SERVICE_TOKEN,
          useValue: integrationsService,
        },
      ],
    }).compile();

    service = module.get(CategoriesCacheService);
  });

  describe('getAllegroCategories', () => {
    it('should return cached categories when cache is fresh', async () => {
      const cached = [
        createMockCategory({ allegroCategoryId: '1', name: 'Electronics', fetchedAt: new Date() }),
        createMockCategory({ allegroCategoryId: '2', name: 'Fashion', fetchedAt: new Date() }),
      ];
      cacheRepo.find.mockResolvedValue(cached);

      const result = await service.getAllegroCategories(CONNECTION_ID);

      expect(result).toEqual([
        { id: '1', name: 'Electronics', parentId: null, leaf: false },
        { id: '2', name: 'Fashion', parentId: null, leaf: false },
      ]);
      expect(integrationsService.getCapabilityAdapter).not.toHaveBeenCalled();
    });

    it('should fetch from API and store when cache is empty', async () => {
      cacheRepo.find.mockResolvedValue([]);

      const apiCategories: OfferCategory[] = [
        { id: '10', name: 'Phones', parentId: '1', leaf: true },
      ];
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        fetchCategories: jest.fn().mockResolvedValue(apiCategories),
      });

      const result = await service.getAllegroCategories(CONNECTION_ID, '1');

      expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith(
        CONNECTION_ID,
        'OfferManager'
      );
      expect(cacheRepo.upsert).toHaveBeenCalled();
      expect(result).toEqual(apiCategories);
    });

    it('should re-fetch when cache entries are stale (>24h)', async () => {
      const staleDate = new Date();
      staleDate.setHours(staleDate.getHours() - 25);

      cacheRepo.find.mockResolvedValue([createMockCategory({ fetchedAt: staleDate })]);

      const freshCategories: OfferCategory[] = [
        { id: '100', name: 'Electronics (updated)', parentId: null, leaf: false },
      ];
      integrationsService.getCapabilityAdapter.mockResolvedValue({
        fetchCategories: jest.fn().mockResolvedValue(freshCategories),
      });

      const result = await service.getAllegroCategories(CONNECTION_ID);

      expect(cacheRepo.delete).toHaveBeenCalled(); // Stale entries cleaned up
      expect(result).toEqual(freshCategories);
    });

    it('should return empty array when adapter does not support fetchCategories', async () => {
      cacheRepo.find.mockResolvedValue([]);
      integrationsService.getCapabilityAdapter.mockResolvedValue({});

      const result = await service.getAllegroCategories(CONNECTION_ID);

      expect(result).toEqual([]);
    });
  });

  describe('getAllegroCategoryPath', () => {
    it('resolves the OfferManager adapter and returns its breadcrumb', async () => {
      const path = [
        { id: '1', name: 'Electronics' },
        { id: '10', name: 'Phones' },
      ];
      const getCategoryPath = jest.fn().mockResolvedValue(path);
      integrationsService.getCapabilityAdapter.mockResolvedValue({ getCategoryPath });

      const result = await service.getAllegroCategoryPath(CONNECTION_ID, '10');

      expect(integrationsService.getCapabilityAdapter).toHaveBeenCalledWith(
        CONNECTION_ID,
        'OfferManager'
      );
      expect(getCategoryPath).toHaveBeenCalledWith('10');
      expect(result).toEqual(path);
    });

    it('returns an empty array when the adapter does not implement CategoryPathReader', async () => {
      integrationsService.getCapabilityAdapter.mockResolvedValue({});

      const result = await service.getAllegroCategoryPath(CONNECTION_ID, '10');

      expect(result).toEqual([]);
    });
  });

  describe('invalidateCache', () => {
    it('should delete all cached entries for a connection', async () => {
      await service.invalidateCache(CONNECTION_ID);

      expect(cacheRepo.delete).toHaveBeenCalledWith({ connectionId: CONNECTION_ID });
    });
  });
});
