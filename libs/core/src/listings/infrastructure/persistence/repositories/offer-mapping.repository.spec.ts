/**
 * Offer Mapping Repository — Unit Tests
 *
 * Verifies read operations, domain mapping, and invalid-UUID error translation.
 *
 * @module libs/core/src/listings/infrastructure/persistence/repositories
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { QueryFailedError } from 'typeorm';

import { IdentifierMapping } from '@openlinker/core/identifier-mapping';
import { IdentifierMappingOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';

import { OfferMappingRepository } from './offer-mapping.repository';

describe('OfferMappingRepository', () => {
  let repository: OfferMappingRepository;
  let ormRepository: jest.Mocked<Repository<IdentifierMappingOrmEntity>>;

  const now = new Date('2026-04-20T10:00:00Z');

  const buildOrm = (
    overrides: Partial<IdentifierMappingOrmEntity> = {}
  ): IdentifierMappingOrmEntity => ({
    id: 'mapping-uuid',
    entityType: 'Offer',
    internalId: 'ol_variant_123',
    externalId: 'allegro-offer-1',
    platformType: 'allegro',
    connectionId: 'conn-uuid',
    context: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });

  beforeEach(async () => {
    const mockOrmRepo = {
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
    } as unknown as jest.Mocked<Repository<IdentifierMappingOrmEntity>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OfferMappingRepository,
        {
          provide: getRepositoryToken(IdentifierMappingOrmEntity),
          useValue: mockOrmRepo,
        },
      ],
    }).compile();

    repository = module.get<OfferMappingRepository>(OfferMappingRepository);
    ormRepository = module.get(getRepositoryToken(IdentifierMappingOrmEntity));
  });

  describe('findById', () => {
    it('should return the mapped domain entity when found', async () => {
      ormRepository.findOne.mockResolvedValue(buildOrm());

      const result = await repository.findById('mapping-uuid');

      expect(ormRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'mapping-uuid', entityType: 'Offer' },
      });
      expect(result).toBeInstanceOf(IdentifierMapping);
      expect(result?.id).toBe('mapping-uuid');
    });

    it('should return null when not found', async () => {
      ormRepository.findOne.mockResolvedValue(null);

      const result = await repository.findById('missing');

      expect(result).toBeNull();
    });

    it('should return null when the driver raises a 22P02 QueryFailedError (invalid UUID)', async () => {
      const error = new QueryFailedError('invalid input syntax for type uuid', [], '');
      (error as QueryFailedError & { code?: string }).code = '22P02';
      ormRepository.findOne.mockRejectedValue(error);

      const result = await repository.findById('not-a-uuid');

      expect(result).toBeNull();
    });

    it('should re-throw a QueryFailedError with a different code', async () => {
      const error = new QueryFailedError('duplicate key value', [], '');
      (error as QueryFailedError & { code?: string }).code = '23505';
      ormRepository.findOne.mockRejectedValue(error);

      await expect(repository.findById('mapping-uuid')).rejects.toBe(error);
    });
  });

  describe('countListedVariantsByProducts (#1720)', () => {
    type CoverageQb = {
      select: jest.Mock;
      addSelect: jest.Mock;
      innerJoin: jest.Mock;
      where: jest.Mock;
      andWhere: jest.Mock;
      groupBy: jest.Mock;
      addGroupBy: jest.Mock;
      getRawMany: jest.Mock;
    };

    function buildCoverageQb(
      rows: Array<{
        productId: string;
        connectionId: string;
        platformType: string;
        listedVariants: string;
      }>
    ): CoverageQb {
      const qb: CoverageQb = {
        select: jest.fn(),
        addSelect: jest.fn(),
        innerJoin: jest.fn(),
        where: jest.fn(),
        andWhere: jest.fn(),
        groupBy: jest.fn(),
        addGroupBy: jest.fn(),
        getRawMany: jest.fn().mockResolvedValue(rows),
      };
      qb.select.mockReturnValue(qb);
      qb.addSelect.mockReturnValue(qb);
      qb.innerJoin.mockReturnValue(qb);
      qb.where.mockReturnValue(qb);
      qb.andWhere.mockReturnValue(qb);
      qb.groupBy.mockReturnValue(qb);
      qb.addGroupBy.mockReturnValue(qb);
      return qb;
    }

    it('should return [] on empty input without touching the query builder', async () => {
      const result = await repository.countListedVariantsByProducts([]);

      expect(result).toEqual([]);
      expect(ormRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('should scope to Offer mappings, join product_variants by table name, and cast counts to numbers', async () => {
      const qb = buildCoverageQb([
        {
          productId: 'ol_product_1',
          connectionId: 'conn-1',
          platformType: 'allegro',
          listedVariants: '2',
        },
      ]);
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      const result = await repository.countListedVariantsByProducts([
        'ol_product_1',
        'ol_product_2',
      ]);

      expect(qb.innerJoin).toHaveBeenCalledWith(
        'product_variants',
        'pv',
        'pv."id" = mapping."internalId"'
      );
      expect(qb.where).toHaveBeenCalledWith('mapping.entityType = :entityType', {
        entityType: 'Offer',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('pv."productId" IN (:...productIds)', {
        productIds: ['ol_product_1', 'ol_product_2'],
      });
      expect(qb.groupBy).toHaveBeenCalledWith('pv."productId"');
      expect(result).toEqual([
        {
          productId: 'ol_product_1',
          connectionId: 'conn-1',
          platformType: 'allegro',
          listedVariants: 2,
        },
      ]);
    });
  });
});
