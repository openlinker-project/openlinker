/**
 * Shop Product Mapping Repository — Unit Tests
 *
 * Mirrors offer-mapping.repository.spec.ts's countListedVariantsByProducts
 * coverage (#1838 follow-up fix), scoped to `entityType = 'ShopProduct'`.
 *
 * @module libs/core/src/listings/infrastructure/persistence/repositories
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

import { IdentifierMappingOrmEntity } from '@openlinker/core/identifier-mapping/orm-entities';

import { ShopProductMappingRepository } from './shop-product-mapping.repository';

describe('ShopProductMappingRepository', () => {
  let repository: ShopProductMappingRepository;
  let ormRepository: jest.Mocked<Repository<IdentifierMappingOrmEntity>>;

  beforeEach(async () => {
    const mockOrmRepo = {
      createQueryBuilder: jest.fn(),
    } as unknown as jest.Mocked<Repository<IdentifierMappingOrmEntity>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShopProductMappingRepository,
        {
          provide: getRepositoryToken(IdentifierMappingOrmEntity),
          useValue: mockOrmRepo,
        },
      ],
    }).compile();

    repository = module.get<ShopProductMappingRepository>(ShopProductMappingRepository);
    ormRepository = module.get(getRepositoryToken(IdentifierMappingOrmEntity));
  });

  describe('countListedVariantsByProducts', () => {
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

    it('should scope to ShopProduct mappings, join product_variants by table name, and cast counts to numbers', async () => {
      const qb = buildCoverageQb([
        {
          productId: 'ol_product_1',
          connectionId: 'conn-woo-1',
          platformType: 'woocommerce',
          listedVariants: '1',
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
        entityType: 'ShopProduct',
      });
      expect(qb.andWhere).toHaveBeenCalledWith('pv."productId" IN (:...productIds)', {
        productIds: ['ol_product_1', 'ol_product_2'],
      });
      expect(qb.groupBy).toHaveBeenCalledWith('pv."productId"');
      expect(result).toEqual([
        {
          productId: 'ol_product_1',
          connectionId: 'conn-woo-1',
          platformType: 'woocommerce',
          listedVariants: 1,
        },
      ]);
    });
  });
});
