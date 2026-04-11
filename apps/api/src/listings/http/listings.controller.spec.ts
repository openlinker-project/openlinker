/**
 * Listings Controller Unit Tests
 *
 * @module apps/api/src/listings/http
 */
import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ListingsController } from './listings.controller';
import { OFFER_MAPPING_REPOSITORY_TOKEN } from '@openlinker/core/listings';
import type { OfferMappingRepositoryPort } from '@openlinker/core/listings';
import { JOB_ENQUEUE_TOKEN } from '@openlinker/core/sync';
import type { JobEnqueuePort } from '@openlinker/core/sync';
import { IdentifierMapping } from '@openlinker/core/identifier-mapping';

describe('ListingsController', () => {
  let controller: ListingsController;
  let repository: jest.Mocked<OfferMappingRepositoryPort>;

  const mockMapping = new IdentifierMapping(
    'uuid-1',
    'Offer',
    'ol_offer_variant123',
    'allegro-offer-456',
    'allegro',
    'conn-1',
    null,
    new Date('2026-01-01T00:00:00Z'),
    new Date('2026-01-01T00:00:00Z'),
  );

  beforeEach(async () => {
    const mockRepository: jest.Mocked<OfferMappingRepositoryPort> = {
      findById: jest.fn(),
      findMany: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ListingsController],
      providers: [
        {
          provide: OFFER_MAPPING_REPOSITORY_TOKEN,
          useValue: mockRepository,
        },
        {
          provide: JOB_ENQUEUE_TOKEN,
          useValue: { enqueueJob: jest.fn() } as jest.Mocked<JobEnqueuePort>,
        },
      ],
    }).compile();

    controller = module.get<ListingsController>(ListingsController);
    repository = module.get(OFFER_MAPPING_REPOSITORY_TOKEN);
  });

  describe('listOfferMappings', () => {
    it('should return paginated offer mappings with default pagination', async () => {
      repository.findMany.mockResolvedValue({ items: [mockMapping], total: 1 });

      const result = await controller.listOfferMappings({});

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
      expect(repository.findMany).toHaveBeenCalledWith(
        { connectionId: undefined, platformType: undefined, internalId: undefined, search: undefined },
        { limit: 20, offset: 0 },
      );
    });

    it('should pass filters to repository', async () => {
      repository.findMany.mockResolvedValue({ items: [], total: 0 });

      await controller.listOfferMappings({
        connectionId: 'conn-1',
        platformType: 'allegro',
        internalId: 'ol_offer_variant123',
        search: '456',
        limit: 10,
        offset: 5,
      });

      expect(repository.findMany).toHaveBeenCalledWith(
        { connectionId: 'conn-1', platformType: 'allegro', internalId: 'ol_offer_variant123', search: '456' },
        { limit: 10, offset: 5 },
      );
    });

    it('should serialize dates as ISO 8601 strings', async () => {
      repository.findMany.mockResolvedValue({ items: [mockMapping], total: 1 });

      const result = await controller.listOfferMappings({});

      expect(result.items[0].createdAt).toBe('2026-01-01T00:00:00.000Z');
      expect(result.items[0].updatedAt).toBe('2026-01-01T00:00:00.000Z');
    });
  });

  describe('getOfferMapping', () => {
    it('should return offer mapping when found', async () => {
      repository.findById.mockResolvedValue(mockMapping);

      const result = await controller.getOfferMapping('uuid-1');

      expect(result.id).toBe('uuid-1');
      expect(result.entityType).toBe('Offer');
      expect(result.externalId).toBe('allegro-offer-456');
      expect(result.platformType).toBe('allegro');
    });

    it('should throw NotFoundException when offer mapping not found', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(controller.getOfferMapping('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });
});
