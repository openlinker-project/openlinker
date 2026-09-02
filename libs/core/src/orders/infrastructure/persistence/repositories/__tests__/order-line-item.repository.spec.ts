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
      query: jest.fn(),
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

  /**
   * A query-builder stub carrying EVERY chained method the repository may
   * call, so adding a clause to a read (the deterministic `ORDER BY`s of
   * #2765/#2766, say) cannot break an unrelated spec with a
   * `.orderBy is not a function` TypeError — which is exactly how the
   * #2766 review found CI red. Named spies are passed in as `overrides`
   * when a spec needs to assert on one.
   */
  const makeQbStub = (
    rows: unknown[],
    overrides: Record<string, jest.Mock> = {}
  ): Record<string, jest.Mock> => {
    const chained = [
      'innerJoin',
      'leftJoin',
      'select',
      'addSelect',
      'where',
      'andWhere',
      'setParameter',
      'setParameters',
      'groupBy',
      'addGroupBy',
      'orderBy',
      'addOrderBy',
      'limit',
      'offset',
      'take',
      'skip',
    ];
    const qb: Record<string, jest.Mock> = {};
    for (const method of chained) {
      qb[method] = jest.fn(() => qb);
    }
    qb.getRawMany = jest.fn().mockResolvedValue(rows);
    qb.getRawOne = jest.fn().mockResolvedValue(rows[0] ?? undefined);
    for (const [name, spy] of Object.entries(overrides)) {
      if (chained.includes(name)) {
        spy.mockImplementation(() => qb);
      }
      qb[name] = spy;
    }
    return qb;
  };

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

  describe('getTopProductRanking (#1988)', () => {
    const baseFilters = {
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: new Date('2026-08-08T00:00:00.000Z'),
      sortBy: 'revenue' as const,
      limit: 20,
      offset: 0,
    };

    const makeRankingQb = (rows: unknown[]) => ({
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      setParameter: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(rows),
    });

    const makeTotalQb = (total: string) => ({
      innerJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawOne: jest.fn().mockResolvedValue({ total }),
    });

    it('returns an empty page and zero total when nothing matches', async () => {
      const rankingQb = makeRankingQb([]);
      const totalQb = makeTotalQb('0');
      (ormRepository.createQueryBuilder as jest.Mock)
        .mockReturnValueOnce(rankingQb)
        .mockReturnValueOnce(totalQb);

      const result = await repository.getTopProductRanking(baseFilters, 'PLN');

      expect(result).toEqual({ rows: [], total: 0 });
    });

    it('maps ranked rows and the total count, coercing numeric strings', async () => {
      const rankingQb = makeRankingQb([
        {
          product_id: 'p1',
          units: '10',
          revenue: '123.45',
          unconverted_revenue: '5',
          unconverted_order_count: '1',
          reporting_currency: 'EUR',
          unconverted_currency: 'PLN',
          net_revenue: '100',
          net_excluded_revenue: '23.45',
          net_excluded_line_count: '2',
        },
      ]);
      const totalQb = makeTotalQb('7');
      (ormRepository.createQueryBuilder as jest.Mock)
        .mockReturnValueOnce(rankingQb)
        .mockReturnValueOnce(totalQb);

      const result = await repository.getTopProductRanking(baseFilters, 'EUR');

      expect(rankingQb.setParameter).toHaveBeenCalledWith('reportingCurrency', 'EUR');
      expect(result).toEqual({
        rows: [
          {
            productId: 'p1',
            units: 10,
            revenue: 123.45,
            unconvertedRevenue: 5,
            unconvertedOrderCount: 1,
            currency: 'EUR',
            unconvertedCurrency: 'PLN',
            netRevenue: 100,
            netExcludedRevenue: 23.45,
            netExcludedLineCount: 2,
          },
        ],
        total: 7,
      });
    });

    it('orders by units when sortBy is units, revenue when sortBy is revenue', async () => {
      const rankingQbUnits = makeRankingQb([]);
      (ormRepository.createQueryBuilder as jest.Mock)
        .mockReturnValueOnce(rankingQbUnits)
        .mockReturnValueOnce(makeTotalQb('0'));
      await repository.getTopProductRanking({ ...baseFilters, sortBy: 'units' }, 'PLN');
      expect(rankingQbUnits.orderBy).toHaveBeenCalledWith('units', 'DESC');

      const rankingQbRevenue = makeRankingQb([]);
      (ormRepository.createQueryBuilder as jest.Mock)
        .mockReturnValueOnce(rankingQbRevenue)
        .mockReturnValueOnce(makeTotalQb('0'));
      await repository.getTopProductRanking({ ...baseFilters, sortBy: 'revenue' }, 'PLN');
      expect(rankingQbRevenue.orderBy).toHaveBeenCalledWith('revenue', 'DESC');
    });

    it('adds a deterministic product_id tiebreaker so pagination over a non-unique sort is stable (#2172 review, IMPORTANT 1)', async () => {
      const rankingQb = makeRankingQb([]);
      (ormRepository.createQueryBuilder as jest.Mock)
        .mockReturnValueOnce(rankingQb)
        .mockReturnValueOnce(makeTotalQb('0'));

      await repository.getTopProductRanking(baseFilters, 'PLN');

      expect(rankingQb.addOrderBy).toHaveBeenCalledWith('product_id', 'ASC');
    });

    it('applies limit/offset for pagination', async () => {
      const rankingQb = makeRankingQb([]);
      (ormRepository.createQueryBuilder as jest.Mock)
        .mockReturnValueOnce(rankingQb)
        .mockReturnValueOnce(makeTotalQb('0'));

      await repository.getTopProductRanking({ ...baseFilters, limit: 5, offset: 10 }, 'PLN');

      expect(rankingQb.limit).toHaveBeenCalledWith(5);
      expect(rankingQb.offset).toHaveBeenCalledWith(10);
    });
  });

  describe('getProductChannelBreakdown (#1988)', () => {
    const baseFilters = {
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: new Date('2026-08-08T00:00:00.000Z'),
    };

    it('returns [] without a DB round-trip when productIds is empty', async () => {
      const result = await repository.getProductChannelBreakdown([], baseFilters, 'PLN');

      expect(result).toEqual([]);
      expect(ormRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('filters by the given productIds and returns one row per (product, connection)', async () => {
      const andWhere = jest.fn().mockReturnThis();
      const setParameter = jest.fn().mockReturnThis();
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        setParameter,
        andWhere,
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          {
            product_id: 'p1',
            source_connection_id: 'conn-a',
            units: '4',
            revenue: '40',
            unconverted_revenue: '0',
            reporting_currency: 'EUR',
            unconverted_currency: null,
            net_revenue: '40',
            net_excluded_revenue: '0',
            net_excluded_line_count: '0',
          },
        ]),
      });

      const result = await repository.getProductChannelBreakdown(['p1'], baseFilters, 'EUR');

      expect(setParameter).toHaveBeenCalledWith('reportingCurrency', 'EUR');
      expect(andWhere).toHaveBeenCalledWith('li."productId" IN (:...productIds)', {
        productIds: ['p1'],
      });
      expect(result).toEqual([
        {
          productId: 'p1',
          sourceConnectionId: 'conn-a',
          units: 4,
          revenue: 40,
          unconvertedRevenue: 0,
          currency: 'EUR',
          unconvertedCurrency: null,
          netRevenue: 40,
          netExcludedRevenue: 0,
          netExcludedLineCount: 0,
        },
      ]);
    });

    it('labels unconvertedCurrency per channel, independently of the ranking row (#2172 review, still-open follow-up)', async () => {
      const setParameter = jest.fn().mockReturnThis();
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        innerJoin: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        setParameter,
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          {
            product_id: 'p1',
            source_connection_id: 'conn-a',
            units: '4',
            revenue: '0',
            unconverted_revenue: '40',
            reporting_currency: null,
            unconverted_currency: 'PLN',
            net_revenue: '0',
            net_excluded_revenue: '0',
            net_excluded_line_count: '0',
          },
        ]),
      });

      const result = await repository.getProductChannelBreakdown(['p1'], baseFilters, 'EUR');

      expect(result).toEqual([
        {
          productId: 'p1',
          sourceConnectionId: 'conn-a',
          units: 4,
          revenue: 0,
          unconvertedRevenue: 40,
          currency: null,
          unconvertedCurrency: 'PLN',
          netRevenue: 0,
          netExcludedRevenue: 0,
          netExcludedLineCount: 0,
        },
      ]);
    });
  });

  describe('getVariantRanking (#2765)', () => {
    const baseFilters = {
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: new Date('2026-08-08T00:00:00.000Z'),
    };

    it('scopes to one product and groups by variant, across every channel', async () => {
      const andWhere = jest.fn();
      const setParameter = jest.fn();
      const groupBy = jest.fn();
      const orderBy = jest.fn();
      const addOrderBy = jest.fn();
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(
        makeQbStub(
          [
            {
              variant_id: 'v1',
              units: '10',
              revenue: '123.45',
              unconverted_revenue: '5',
              unconverted_order_count: '1',
              reporting_currency: 'EUR',
              unconverted_currency: 'PLN',
              net_revenue: '100',
              net_excluded_revenue: '23.45',
              net_excluded_line_count: '2',
            },
          ],
          { andWhere, setParameter, groupBy, orderBy, addOrderBy }
        )
      );

      const result = await repository.getVariantRanking('p1', baseFilters, 'EUR');

      expect(setParameter).toHaveBeenCalledWith('reportingCurrency', 'EUR');
      expect(andWhere).toHaveBeenCalledWith('li."productId" = :productId', { productId: 'p1' });
      expect(groupBy).toHaveBeenCalledWith('li.variantId');
      // Deterministic ranking order, Unassigned pinned to the edge (#2765
      // review, finding 2).
      expect(orderBy).toHaveBeenCalledWith('revenue', 'DESC');
      expect(addOrderBy).toHaveBeenCalledWith('variant_id', 'ASC', 'NULLS LAST');
      expect(result).toEqual([
        {
          variantId: 'v1',
          units: 10,
          revenue: 123.45,
          unconvertedRevenue: 5,
          unconvertedOrderCount: 1,
          currency: 'EUR',
          unconvertedCurrency: 'PLN',
          netRevenue: 100,
          netExcludedRevenue: 23.45,
          netExcludedLineCount: 2,
        },
      ]);
    });

    it('reports a null variant_id row as its own row rather than coercing it', async () => {
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(
        makeQbStub([
          {
            variant_id: null,
            units: '1',
            revenue: '0',
            unconverted_revenue: '20',
            unconverted_order_count: '1',
            reporting_currency: null,
            unconverted_currency: 'EUR',
            net_revenue: '0',
            net_excluded_revenue: '0',
            net_excluded_line_count: '0',
          },
        ])
      );

      const result = await repository.getVariantRanking('p1', baseFilters, 'EUR');

      expect(result[0].variantId).toBeNull();
    });
  });

  describe('getVariantChannelBreakdown (#2765)', () => {
    const baseFilters = {
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: new Date('2026-08-08T00:00:00.000Z'),
    };

    it('scopes to one product and groups by (variant, connection)', async () => {
      const andWhere = jest.fn();
      const setParameter = jest.fn();
      const groupBy = jest.fn();
      const addGroupBy = jest.fn();
      const orderBy = jest.fn();
      const addOrderBy = jest.fn();
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(
        makeQbStub(
          [
            {
              variant_id: 'v1',
              source_connection_id: 'conn-a',
              units: '4',
              revenue: '40',
              unconverted_revenue: '0',
              reporting_currency: 'EUR',
              unconverted_currency: null,
              net_revenue: '40',
              net_excluded_revenue: '0',
              net_excluded_line_count: '0',
            },
          ],
          { andWhere, setParameter, groupBy, addGroupBy, orderBy, addOrderBy }
        )
      );

      const result = await repository.getVariantChannelBreakdown('p1', baseFilters, 'EUR');

      expect(setParameter).toHaveBeenCalledWith('reportingCurrency', 'EUR');
      expect(andWhere).toHaveBeenCalledWith('li."productId" = :productId', { productId: 'p1' });
      expect(groupBy).toHaveBeenCalledWith('li.variantId');
      expect(addGroupBy).toHaveBeenCalledWith('li.sourceConnectionId');
      // Deterministic breakdown order (#2766 review, finding 6).
      expect(orderBy).toHaveBeenCalledWith('variant_id', 'ASC', 'NULLS LAST');
      expect(addOrderBy).toHaveBeenCalledWith('source_connection_id', 'ASC');
      expect(result).toEqual([
        {
          variantId: 'v1',
          sourceConnectionId: 'conn-a',
          units: 4,
          revenue: 40,
          unconvertedRevenue: 0,
          currency: 'EUR',
          unconvertedCurrency: null,
          netRevenue: 40,
          netExcludedRevenue: 0,
          netExcludedLineCount: 0,
        },
      ]);
    });
  });

  describe('findPageWithNoTaxRate', () => {
    const makeQb = (rows: OrderLineItemOrmEntity[]) => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(rows),
    });

    it('scopes to the connection and scans the no-tax-rate predicate ordered by id, with no afterId cursor on the first page', async () => {
      const qb = makeQb([createOrmEntity({ id: 'line-1' })]);
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      const result = await repository.findPageWithNoTaxRate({
        sourceConnectionId: 'conn-1',
        limit: 100,
        afterId: null,
      });

      expect(qb.where).toHaveBeenCalledWith('li."taxRate" IS NULL');
      expect(qb.andWhere).toHaveBeenCalledWith('li."sourceConnectionId" = :sourceConnectionId', {
        sourceConnectionId: 'conn-1',
      });
      expect(qb.andWhere).toHaveBeenCalledTimes(1);
      expect(qb.orderBy).toHaveBeenCalledWith('li."id"', 'ASC');
      expect(qb.take).toHaveBeenCalledWith(100);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('line-1');
    });

    it('excludes rows at or before the cursor on a resumed page', async () => {
      const qb = makeQb([]);
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      await repository.findPageWithNoTaxRate({
        sourceConnectionId: 'conn-1',
        limit: 50,
        afterId: 'line-99',
      });

      expect(qb.andWhere).toHaveBeenCalledWith('li."id" > :afterId', { afterId: 'line-99' });
      expect(qb.andWhere).toHaveBeenCalledTimes(2);
    });
  });

  describe('backfillTaxRate', () => {
    it('writes the rate/source/readAt triple guarded by taxRate IS NULL', async () => {
      const readAt = new Date('2026-08-24T00:00:00.000Z');

      await repository.backfillTaxRate('line-1', {
        taxRate: '23',
        taxSource: 'backfill',
        taxRateReadAt: readAt,
      });

      expect(ormRepository.query).toHaveBeenCalledTimes(1);
      const [sql, params] = (ormRepository.query as jest.Mock).mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/WHERE\s+"id"\s*=\s*\$4\s+AND\s+"taxRate"\s+IS\s+NULL/);
      expect(params).toEqual(['23', 'backfill', readAt, 'line-1']);
    });
  });
});
