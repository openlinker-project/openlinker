/**
 * Inventory Repository - Unit Tests
 *
 * Focused coverage of the product-level stock aggregate read (#1720):
 * query-builder wiring (grouping, stale exclusion, parameterisation), the
 * numeric normalisation of Postgres raw rows, and the empty-input
 * short-circuit. Row-level CRUD paths are exercised via integration suites.
 *
 * @module libs/core/src/inventory/infrastructure/persistence/repositories
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository, SelectQueryBuilder } from 'typeorm';

import { InventoryItemOrmEntity } from '../entities/inventory-item.orm-entity';
import { InventoryRepository } from './inventory.repository';

type RawAggregateRow = {
  productId: string;
  totalAvailable: string;
  totalReserved: string;
  stockUpdatedAt: Date | string;
};

/** Chainable query-builder stub capturing the calls the SUT issues. */
function buildQueryBuilderMock(rows: RawAggregateRow[]): jest.Mocked<
  Pick<
    SelectQueryBuilder<InventoryItemOrmEntity>,
    'select' | 'addSelect' | 'where' | 'andWhere' | 'groupBy' | 'getRawMany'
  >
> {
  const qb = {
    select: jest.fn(),
    addSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    groupBy: jest.fn(),
    getRawMany: jest.fn().mockResolvedValue(rows),
  };
  qb.select.mockReturnValue(qb);
  qb.addSelect.mockReturnValue(qb);
  qb.where.mockReturnValue(qb);
  qb.andWhere.mockReturnValue(qb);
  qb.groupBy.mockReturnValue(qb);
  return qb as unknown as jest.Mocked<
    Pick<
      SelectQueryBuilder<InventoryItemOrmEntity>,
      'select' | 'addSelect' | 'where' | 'andWhere' | 'groupBy' | 'getRawMany'
    >
  >;
}

describe('InventoryRepository', () => {
  let repository: InventoryRepository;
  let ormRepository: jest.Mocked<Repository<InventoryItemOrmEntity>>;

  beforeEach(async () => {
    const mockOrmRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      findAndCount: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      createQueryBuilder: jest.fn(),
    } as unknown as jest.Mocked<Repository<InventoryItemOrmEntity>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryRepository,
        {
          provide: getRepositoryToken(InventoryItemOrmEntity),
          useValue: mockOrmRepo,
        },
      ],
    }).compile();

    repository = module.get<InventoryRepository>(InventoryRepository);
    ormRepository = module.get(getRepositoryToken(InventoryItemOrmEntity));
  });

  describe('findStockAggregatesByProductIds (#1720)', () => {
    it('returns [] on empty input without touching the query builder', async () => {
      const result = await repository.findStockAggregatesByProductIds([]);

      expect(result).toEqual([]);
      expect(ormRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('groups by productId, excludes stale rows, and casts numeric strings to numbers', async () => {
      const updatedAt = new Date('2026-05-01T12:00:00Z');
      const qb = buildQueryBuilderMock([
        {
          productId: 'prod-1',
          totalAvailable: '12',
          totalReserved: '3',
          stockUpdatedAt: updatedAt,
        },
      ]);
      ormRepository.createQueryBuilder.mockReturnValue(
        qb as unknown as SelectQueryBuilder<InventoryItemOrmEntity>
      );

      const result = await repository.findStockAggregatesByProductIds(['prod-1', 'prod-2']);

      expect(qb.where).toHaveBeenCalledWith('inv.productId IN (:...productIds)', {
        productIds: ['prod-1', 'prod-2'],
      });
      expect(qb.andWhere).toHaveBeenCalledWith('inv.isStale = false');
      expect(qb.groupBy).toHaveBeenCalledWith('inv.productId');
      expect(result).toEqual([
        {
          productId: 'prod-1',
          totalAvailable: 12,
          totalReserved: 3,
          stockUpdatedAt: updatedAt,
        },
      ]);
    });

    it('normalises a string stockUpdatedAt from the driver into a Date', async () => {
      const qb = buildQueryBuilderMock([
        {
          productId: 'prod-1',
          totalAvailable: '0',
          totalReserved: '0',
          stockUpdatedAt: '2026-05-01T12:00:00.000Z',
        },
      ]);
      ormRepository.createQueryBuilder.mockReturnValue(
        qb as unknown as SelectQueryBuilder<InventoryItemOrmEntity>
      );

      const result = await repository.findStockAggregatesByProductIds(['prod-1']);

      expect(result[0].stockUpdatedAt).toEqual(new Date('2026-05-01T12:00:00.000Z'));
    });
  });
});
