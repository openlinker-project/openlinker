/**
 * Order Line Item Repository Unit Tests
 *
 * @module libs/core/src/orders/infrastructure/persistence/repositories/__tests__
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { OrderLineItemRepository } from '../order-line-item.repository';
import { OrderLineItemOrmEntity } from '../../entities/order-line-item.orm-entity';

describe('OrderLineItemRepository', () => {
  let repository: OrderLineItemRepository;
  let ormRepository: jest.Mocked<Repository<OrderLineItemOrmEntity>>;

  beforeEach(async () => {
    const mockOrmRepository = {
      find: jest.fn(),
      createQueryBuilder: jest.fn(),
    } as unknown as jest.Mocked<Repository<OrderLineItemOrmEntity>>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderLineItemRepository,
        {
          provide: getRepositoryToken(OrderLineItemOrmEntity),
          useValue: mockOrmRepository,
        },
      ],
    }).compile();

    repository = module.get<OrderLineItemRepository>(OrderLineItemRepository);
    ormRepository = module.get(getRepositoryToken(OrderLineItemOrmEntity));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const createOrmEntity = (overrides: Partial<OrderLineItemOrmEntity> = {}): OrderLineItemOrmEntity => {
    const entity = new OrderLineItemOrmEntity();
    entity.id = 'line-1';
    entity.orderRecordId = 'order-123';
    entity.lineNumber = 0;
    entity.productId = 'ol_product_1';
    entity.variantId = 'ol_variant_1';
    entity.quantity = 2;
    entity.unitPrice = 10 as unknown as number; // decimal column arrives as a string at runtime
    entity.sourceConnectionId = 'conn-123';
    entity.placedAt = null;
    entity.createdAt = new Date('2026-08-01T10:00:00.000Z');
    return Object.assign(entity, overrides);
  };

  describe('findByOrderId', () => {
    it('returns line items ordered by lineNumber, mapped to domain', async () => {
      ormRepository.find.mockResolvedValue([createOrmEntity()]);

      const result = await repository.findByOrderId('order-123');

      expect(ormRepository.find).toHaveBeenCalledWith({
        where: { orderRecordId: 'order-123' },
        order: { lineNumber: 'ASC' },
      });
      expect(result).toHaveLength(1);
      expect(result[0].productId).toBe('ol_product_1');
      expect(result[0].variantId).toBe('ol_variant_1');
    });

    it('converts a string-valued decimal unitPrice back to a number', async () => {
      ormRepository.find.mockResolvedValue([
        createOrmEntity({ unitPrice: '19.99' as unknown as number }),
      ]);

      const result = await repository.findByOrderId('order-123');

      expect(result[0].unitPrice).toBe(19.99);
      expect(typeof result[0].unitPrice).toBe('number');
    });

    it('returns [] when the order has no line items', async () => {
      ormRepository.find.mockResolvedValue([]);

      const result = await repository.findByOrderId('order-without-items');

      expect(result).toEqual([]);
    });
  });

  describe('getUnitsSoldByConnection (#1987)', () => {
    const baseFilters = {
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: new Date('2026-08-08T00:00:00.000Z'),
    };

    it('returns an empty Map when nothing matches', async () => {
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        setParameter: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      });

      const result = await repository.getUnitsSoldByConnection(baseFilters, 'EUR');

      expect(result.size).toBe(0);
    });

    it('returns one Map entry per connection with the current-era and unconverted quantities split', async () => {
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        setParameter: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          { source_connection_id: 'conn-a', units: '12', unconverted_units: '2' },
          { source_connection_id: 'conn-b', units: '3', unconverted_units: '0' },
        ]),
      });

      const result = await repository.getUnitsSoldByConnection(baseFilters, 'EUR');

      expect(result.get('conn-a')).toEqual({ unitsSold: 12, unconvertedUnitsSold: 2 });
      expect(result.get('conn-b')).toEqual({ unitsSold: 3, unconvertedUnitsSold: 0 });
    });

    it('binds the current reporting currency as a query parameter', async () => {
      const setParameter = jest.fn().mockReturnThis();
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        setParameter,
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      });

      await repository.getUnitsSoldByConnection(baseFilters, 'PLN');

      expect(setParameter).toHaveBeenCalledWith('currentReportingCurrency', 'PLN');
    });

    it('applies the sourceConnectionId filter when provided', async () => {
      const andWhere = jest.fn().mockReturnThis();
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere,
        setParameter: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      });

      await repository.getUnitsSoldByConnection(
        { ...baseFilters, sourceConnectionId: 'conn-a' },
        'EUR'
      );

      expect(andWhere).toHaveBeenCalledWith('li.sourceConnectionId = :salesConnectionId', {
        salesConnectionId: 'conn-a',
      });
    });
  });
});
