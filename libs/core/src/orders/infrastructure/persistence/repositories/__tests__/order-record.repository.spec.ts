/**
 * Order Record Repository Unit Tests
 *
 * Unit tests for OrderRecordRepository, verifying order record persistence operations,
 * sync status updates, and entity conversion.
 *
 * @module libs/core/src/orders/infrastructure/persistence/repositories/__tests__
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository, UpdateResult } from 'typeorm';
import { IsNull, LessThan, MoreThanOrEqual } from 'typeorm';
import { OrderRecordRepository } from '../order-record.repository';
import type { OrderSyncStatusJson } from '../../entities/order-record.orm-entity';
import { OrderRecordOrmEntity } from '../../entities/order-record.orm-entity';
import { OrderRecord } from '../../../../domain/entities/order-record.entity';
import type { OrderSyncStatus, SyncAttempt } from '../../../../domain/types/order-sync.types';
import { OrderRecordNotFoundException } from '../../../../domain/exceptions/order-record-not-found.exception';

describe('OrderRecordRepository', () => {
  let repository: OrderRecordRepository;
  let ormRepository: jest.Mocked<Repository<OrderRecordOrmEntity>>;
  let transactionalManager: { save: jest.Mock<Promise<unknown>, unknown[]>; delete: jest.Mock };

  beforeEach(async () => {
    const qb = {
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };

    transactionalManager = {
      save: jest.fn(),
      delete: jest.fn(),
    };

    const mockOrmRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      query: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(qb),
      manager: {
        connection: {
          transaction: jest.fn(async (cb: (manager: unknown) => Promise<unknown>) =>
            cb(transactionalManager)
          ),
        },
      },
    } as unknown as jest.Mocked<Repository<OrderRecordOrmEntity>> & { _qb: typeof qb };

    (mockOrmRepository as unknown as { _qb: typeof qb })._qb = qb;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderRecordRepository,
        {
          provide: getRepositoryToken(OrderRecordOrmEntity),
          useValue: mockOrmRepository,
        },
      ],
    }).compile();

    repository = module.get<OrderRecordRepository>(OrderRecordRepository);
    ormRepository = module.get(getRepositoryToken(OrderRecordOrmEntity));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const createOrmEntity = (): OrderRecordOrmEntity => {
    const entity = new OrderRecordOrmEntity();
    entity.internalOrderId = 'order-123';
    entity.customerId = 'customer-456';
    entity.sourceConnectionId = 'source-connection-123';
    entity.sourceEventId = 'event-456';
    entity.orderSnapshot = {
      id: 'order-123',
      orderNumber: 'ORD-001',
      status: 'pending',
    };
    entity.syncStatus = [];
    entity.syncAttempts = [];
    entity.recordStatus = 'ready';
    entity.createdAt = new Date('2025-01-01T10:00:00Z');
    entity.updatedAt = new Date('2025-01-01T10:00:00Z');
    return entity;
  };

  const createDomainEntity = (): OrderRecord => {
    return new OrderRecord(
      'order-123',
      'customer-456',
      'source-connection-123',
      'event-456',
      {
        id: 'order-123',
        orderNumber: 'ORD-001',
        status: 'pending',
      },
      [],
      'ready',
      new Date('2025-01-01T10:00:00Z'),
      new Date('2025-01-01T10:00:00Z')
    );
  };

  describe('findById', () => {
    it('should return order record when found', async () => {
      const entity = createOrmEntity();
      ormRepository.findOne.mockResolvedValue(entity);

      const result = await repository.findById('order-123');

      expect(result).toBeDefined();
      expect(result?.internalOrderId).toBe('order-123');
      expect(result?.customerId).toBe('customer-456');
      expect(result?.sourceConnectionId).toBe('source-connection-123');
      expect(ormRepository.findOne).toHaveBeenCalledWith({
        where: { internalOrderId: 'order-123' },
      });
    });

    it('should return null when not found', async () => {
      ormRepository.findOne.mockResolvedValue(null);

      const result = await repository.findById('non-existent-order');

      expect(result).toBeNull();
    });

    it('should convert sync status from JSONB to domain entities', async () => {
      const entity = createOrmEntity();
      const syncStatusJson: OrderSyncStatusJson[] = [
        {
          destinationConnectionId: 'dest-connection-789',
          status: 'synced',
          syncedAt: '2025-01-01T11:00:00Z',
          externalOrderId: 'external-order-999',
          externalOrderNumber: 'EXT-001',
        },
      ];
      entity.syncStatus = syncStatusJson;
      ormRepository.findOne.mockResolvedValue(entity);

      const result = await repository.findById('order-123');

      expect(result).toBeDefined();
      expect(result?.syncStatus).toHaveLength(1);
      expect(result?.syncStatus[0].destinationConnectionId).toBe('dest-connection-789');
      expect(result?.syncStatus[0].status).toBe('synced');
      expect(result?.syncStatus[0].syncedAt).toEqual(new Date('2025-01-01T11:00:00Z'));
      expect(result?.syncStatus[0].externalOrderId).toBe('external-order-999');
    });
  });

  describe('findByIds', () => {
    it('should return [] without querying when given an empty array', async () => {
      const result = await repository.findByIds([]);

      expect(result).toEqual([]);
      expect(ormRepository.find).not.toHaveBeenCalled();
    });

    it('should return matching domain entities for a batch of ids', async () => {
      const entity = createOrmEntity();
      ormRepository.find.mockResolvedValue([entity]);

      const result = await repository.findByIds(['order-123', 'non-existent-order']);

      expect(result).toHaveLength(1);
      expect(result[0].internalOrderId).toBe('order-123');
      expect(ormRepository.find).toHaveBeenCalledWith({
        where: { internalOrderId: expect.anything() },
      });
    });

    it('should silently omit ids with no matching row', async () => {
      ormRepository.find.mockResolvedValue([]);

      const result = await repository.findByIds(['missing-1', 'missing-2']);

      expect(result).toEqual([]);
    });
  });

  describe('findEarliestOrderDateByConnection (#2083)', () => {
    it('should return an empty Map without querying when given an empty array', async () => {
      const result = await repository.findEarliestOrderDateByConnection([]);

      expect(result).toEqual(new Map());
      expect(ormRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('should return one Map entry per connection with the correct MIN', async () => {
      const earliestA = new Date('2026-01-01T00:00:00.000Z');
      const earliestB = new Date('2026-02-15T00:00:00.000Z');
      const where = jest.fn().mockReturnThis();
      const groupBy = jest.fn().mockReturnThis();
      const addSelect = jest.fn().mockReturnThis();
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect,
        where,
        groupBy,
        getRawMany: jest.fn().mockResolvedValue([
          { source_connection_id: 'conn-a', earliest_at: earliestA },
          { source_connection_id: 'conn-b', earliest_at: earliestB },
        ]),
      });

      const result = await repository.findEarliestOrderDateByConnection(['conn-a', 'conn-b']);

      expect(result.get('conn-a')).toEqual(earliestA);
      expect(result.get('conn-b')).toEqual(earliestB);
      expect(where).toHaveBeenCalledWith('rec.sourceConnectionId IN (:...connectionIds)', {
        connectionIds: ['conn-a', 'conn-b'],
      });
      expect(groupBy).toHaveBeenCalledWith('rec.sourceConnectionId');
      expect(addSelect).toHaveBeenCalledWith(
        expect.stringContaining('COALESCE(rec."placedAt", rec."createdAt")'),
        'earliest_at'
      );
    });

    it('should omit a connection with zero matching rows from the returned Map', async () => {
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      });

      const result = await repository.findEarliestOrderDateByConnection(['conn-with-no-orders']);

      expect(result.has('conn-with-no-orders')).toBe(false);
      expect(result.size).toBe(0);
    });

    it('should not filter by recordStatus — every row (source_deleted, awaiting_mapping, failed, cancelled) counts toward the earliest date', async () => {
      const andWhere = jest.fn().mockReturnThis();
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere,
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      });

      await repository.findEarliestOrderDateByConnection(['conn-a']);

      // This is a coverage/freshness fact, not a health or revenue figure —
      // no NOT_MAPPING_OR_DELETED-style gate applies (#2083 review finding).
      expect(andWhere).not.toHaveBeenCalled();
    });
  });

  describe('getDailyOrderAggregates (#1987)', () => {
    const baseFilters = {
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: new Date('2026-08-08T00:00:00.000Z'),
    };

    it('returns an empty array when nothing matches', async () => {
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        setParameter: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      });

      const result = await repository.getDailyOrderAggregates(baseFilters, 'EUR');

      expect(result).toEqual([]);
    });

    it('maps one row per (day, connection) with the cancelled split', async () => {
      const day = new Date('2026-08-02T00:00:00.000Z');
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        setParameter: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([
          {
            day,
            source_connection_id: 'conn-a',
            order_count: '3',
            revenue: '150.50',
            unconverted_count: '1',
            unconverted_value: '15.00',
            unconverted_currency: 'PLN',
            cancelled_count: '1',
            cancelled_value: '20.00',
            cancelled_unconverted_count: '0',
            cancelled_unconverted_value: '0',
            reporting_currency: 'EUR',
            net_revenue: '0',
            net_excluded_count: '0',
            net_excluded_value: '0',
          },
        ]),
      });

      const result = await repository.getDailyOrderAggregates(baseFilters, 'EUR');

      expect(result).toEqual([
        {
          day,
          sourceConnectionId: 'conn-a',
          orderCount: 3,
          revenue: 150.5,
          unconvertedCount: 1,
          unconvertedValue: 15,
          unconvertedCurrency: 'PLN',
          netRevenue: 0,
          netExcludedCount: 0,
          netExcludedValue: 0,
          cancelledCount: 1,
          cancelledValue: 20,
          cancelledUnconvertedCount: 0,
          cancelledUnconvertedValue: 0,
          reportingCurrency: 'EUR',
        },
      ]);
    });

    it('applies the sourceConnectionId filter when provided', async () => {
      const andWhere = jest.fn().mockReturnThis();
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        andWhere,
        setParameter: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      });

      await repository.getDailyOrderAggregates(
        { ...baseFilters, sourceConnectionId: 'conn-a' },
        'EUR'
      );

      expect(andWhere).toHaveBeenCalledWith('rec.sourceConnectionId = :salesConnectionId', {
        salesConnectionId: 'conn-a',
      });
    });

    it('buckets by an explicit UTC day boundary, not the session-timezone-dependent default (#1987 review, IMPORTANT 2)', async () => {
      const select = jest.fn().mockReturnThis();
      const groupBy = jest.fn().mockReturnThis();
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        select,
        addSelect: jest.fn().mockReturnThis(),
        groupBy,
        addGroupBy: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        setParameter: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      });

      await repository.getDailyOrderAggregates(baseFilters, 'EUR');

      const utcDayFragment = `date_trunc('day', rec."placedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`;
      expect(select).toHaveBeenCalledWith(utcDayFragment, 'day');
      expect(groupBy).toHaveBeenCalledWith(utcDayFragment);
    });

    it('binds the current reporting currency as a query parameter', async () => {
      const setParameter = jest.fn().mockReturnThis();
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        setParameter,
        getRawMany: jest.fn().mockResolvedValue([]),
      });

      await repository.getDailyOrderAggregates(baseFilters, 'PLN');

      expect(setParameter).toHaveBeenCalledWith('currentReportingCurrency', 'PLN');
    });

    it('scopes order_count/revenue to the CURRENT reporting currency, not a bare IS NOT NULL (#1987 review notes)', async () => {
      const addSelect = jest.fn().mockReturnThis();
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect,
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        setParameter: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      });

      await repository.getDailyOrderAggregates(baseFilters, 'EUR');

      const calls = addSelect.mock.calls as Array<[string, string]>;
      const orderCountCall = calls.find(([, alias]) => alias === 'order_count');
      const reportingCurrencyCall = calls.find(([, alias]) => alias === 'reporting_currency');
      expect(orderCountCall?.[0]).toContain('rec."reportingCurrency" = :currentReportingCurrency');
      expect(orderCountCall?.[0]).not.toContain('IS NOT NULL');
      expect(reportingCurrencyCall?.[0]).toContain('MAX(rec."reportingCurrency")');
    });

    it('folds a prior-era stamp into the unconverted bucket alongside never-stamped rows', async () => {
      const addSelect = jest.fn().mockReturnThis();
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect,
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        setParameter: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      });

      await repository.getDailyOrderAggregates(baseFilters, 'EUR');

      const calls = addSelect.mock.calls as Array<[string, string]>;
      const unconvertedCountCall = calls.find(([, alias]) => alias === 'unconverted_count');
      expect(unconvertedCountCall?.[0]).toContain('rec."reportingCurrency" IS NULL');
      expect(unconvertedCountCall?.[0]).toContain(
        'rec."reportingCurrency" != :currentReportingCurrency'
      );
    });

    it('treats a bucket with an unrecorded native currency as not-uniform (#1987 review, suggestion 4)', async () => {
      const addSelect = jest.fn().mockReturnThis();
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect,
        groupBy: jest.fn().mockReturnThis(),
        addGroupBy: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        setParameter: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      });

      await repository.getDailyOrderAggregates(baseFilters, 'EUR');

      const calls = addSelect.mock.calls as Array<[string, string]>;
      const unconvertedCurrencyCall = calls.find(([, alias]) => alias === 'unconverted_currency');
      expect(unconvertedCurrencyCall?.[0]).toContain('rec."currency" IS NULL) = 0');
    });
  });

  describe('findCurrencyMismatchOrders (#2464)', () => {
    const baseFilters = {
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: new Date('2026-08-08T00:00:00.000Z'),
    };

    const createMismatchEntity = (overrides: Partial<OrderRecordOrmEntity>): OrderRecordOrmEntity => {
      const entity = createOrmEntity();
      Object.assign(entity, overrides);
      return entity;
    };

    it('applies the combined never-stamped-or-stale predicate, non-cancelled, with pagination', async () => {
      const andWhere = jest.fn().mockReturnThis();
      const orderBy = jest.fn().mockReturnThis();
      const take = jest.fn().mockReturnThis();
      const skip = jest.fn().mockReturnThis();
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        andWhere,
        orderBy,
        take,
        skip,
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      });

      await repository.findCurrencyMismatchOrders(baseFilters, 'EUR', { limit: 20, offset: 40 });

      expect(andWhere).toHaveBeenCalledWith('rec."cancelledAt" IS NULL');
      expect(andWhere).toHaveBeenCalledWith(
        '(rec."reportingCurrency" IS NULL OR rec."reportingCurrency" != :currentReportingCurrency)',
        { currentReportingCurrency: 'EUR' }
      );
      expect(orderBy).toHaveBeenCalledWith('rec."placedAt"', 'DESC');
      expect(take).toHaveBeenCalledWith(20);
      expect(skip).toHaveBeenCalledWith(40);
    });

    it('scopes to the sourceConnectionId filter when provided (via the shared analytics scope)', async () => {
      const andWhere = jest.fn().mockReturnThis();
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        andWhere,
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      });

      await repository.findCurrencyMismatchOrders(
        { ...baseFilters, sourceConnectionId: 'conn-a' },
        'EUR',
        { limit: 20, offset: 0 }
      );

      expect(andWhere).toHaveBeenCalledWith('rec.sourceConnectionId = :salesConnectionId', {
        salesConnectionId: 'conn-a',
      });
    });

    it('maps a never-stamped row (reportingCurrency null) to the row shape', async () => {
      const entity = createMismatchEntity({
        internalOrderId: 'order-never-stamped',
        sourceConnectionId: 'conn-a',
        currency: 'PLN',
        reportingCurrency: null,
        fxStampedAt: null,
      });
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[entity], 1]),
      });

      const result = await repository.findCurrencyMismatchOrders(baseFilters, 'EUR', {
        limit: 20,
        offset: 0,
      });

      expect(result.total).toBe(1);
      expect(result.items).toEqual([
        {
          internalOrderId: 'order-never-stamped',
          sourceConnectionId: 'conn-a',
          nativeCurrency: 'PLN',
          stampedCurrency: null,
          stampedAt: null,
          productId: null,
          variantId: null,
        },
      ]);
    });

    it('maps a stale-stamp row (reportingCurrency set to a prior era) to the row shape', async () => {
      const stampedAt = new Date('2026-06-01T10:00:00.000Z');
      const entity = createMismatchEntity({
        internalOrderId: 'order-stale-stamp',
        sourceConnectionId: 'conn-a',
        currency: 'PLN',
        reportingCurrency: 'EUR',
        fxStampedAt: stampedAt,
      });
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[entity], 1]),
      });

      // The demo-DB shape from the issue: a same-currency stale stamp
      // (reportingCurrency='EUR', currency='PLN') — the current setting has
      // since moved on to a different value, e.g. 'PLN'.
      const result = await repository.findCurrencyMismatchOrders(baseFilters, 'PLN', {
        limit: 20,
        offset: 0,
      });

      expect(result.total).toBe(1);
      expect(result.items).toEqual([
        {
          internalOrderId: 'order-stale-stamp',
          sourceConnectionId: 'conn-a',
          nativeCurrency: 'PLN',
          stampedCurrency: 'EUR',
          stampedAt,
          productId: null,
          variantId: null,
        },
      ]);
    });

    it('returns an empty page when nothing matches (backs the all-clear mockup state)', async () => {
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      });

      const result = await repository.findCurrencyMismatchOrders(baseFilters, 'EUR', {
        limit: 20,
        offset: 0,
      });

      expect(result).toEqual({ items: [], total: 0 });
    });
  });

  describe('currency restatement reads/writes (#2468)', () => {
    const baseFilters = {
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: new Date('2026-08-08T00:00:00.000Z'),
    };

    it('enumerates by keyset ASC on internalOrderId, never by offset', async () => {
      // A cleared stamp still satisfies the mismatch predicate
      // (`reportingCurrency IS NULL`), so an offset walk would re-read the same
      // page forever. A strictly-increasing key can only move forward.
      const andWhere = jest.fn().mockReturnThis();
      const orderBy = jest.fn().mockReturnThis();
      const limit = jest.fn().mockReturnThis();
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        andWhere,
        orderBy,
        limit,
        getRawMany: jest.fn().mockResolvedValue([]),
      });

      await repository.findCurrencyMismatchOrderRefsAfter(baseFilters, 'EUR', {
        afterOrderId: 'ol_order_m',
        limit: 200,
      });

      expect(orderBy).toHaveBeenCalledWith('rec."internalOrderId"', 'ASC');
      expect(limit).toHaveBeenCalledWith(200);
      expect(andWhere).toHaveBeenCalledWith('rec."internalOrderId" > :afterOrderId', {
        afterOrderId: 'ol_order_m',
      });
      expect(andWhere).toHaveBeenCalledWith(
        '(rec."reportingCurrency" IS NULL OR rec."reportingCurrency" != :currentReportingCurrency)',
        { currentReportingCurrency: 'EUR' }
      );
    });

    it('omits the keyset bound entirely on the first page', async () => {
      const andWhere = jest.fn().mockReturnThis();
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        andWhere,
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      });

      await repository.findCurrencyMismatchOrderRefsAfter(baseFilters, 'EUR', {
        afterOrderId: null,
        limit: 50,
      });

      expect(andWhere).not.toHaveBeenCalledWith(
        'rec."internalOrderId" > :afterOrderId',
        expect.anything()
      );
    });

    it('returns bare ids — #2776 removed the child job that once needed sourceConnectionId alongside them', async () => {
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([{ internal_order_id: 'ol_order_a' }]),
      });

      await expect(
        repository.findCurrencyMismatchOrderRefsAfter(baseFilters, 'EUR', {
          afterOrderId: null,
          limit: 50,
        })
      ).resolves.toEqual(['ol_order_a']);
    });

    /**
     * Builds a mock `createQueryBuilder().update()` chain and returns it, so the
     * guard can be asserted as SQL rather than as a TypeORM operator object.
     */
    const mockClearQueryBuilder = (
      affected: number
    ): { set: jest.Mock; where: jest.Mock; andWhere: jest.Mock } => {
      const chain = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected }),
      };
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(chain);
      return chain;
    };

    it('clears exactly the six FX columns in one statement', async () => {
      // Every one of the six matters - see the port's JSDoc. `fxIntendedCurrency`
      // is the subtle one: leaving it behind makes `resolveIntent` re-pin the
      // stale currency and re-stamp it, so the bug looks fixed and is not.
      const chain = mockClearQueryBuilder(1);

      await expect(repository.clearFxStampForRestatement('ol_order_a')).resolves.toBe(true);

      expect(chain.set).toHaveBeenCalledWith({
        reportingCurrency: null,
        reportingTotalAmount: null,
        exchangeRateId: null,
        fxStampedAt: null,
        fxIntendedCurrency: null,
        fxRule: null,
      });
      expect(chain.where).toHaveBeenCalledWith(expect.stringContaining('"internalOrderId"'), {
        internalOrderId: 'ol_order_a',
      });
    });

    it('guards on ANY FX-group state, not on a figure alone, so deferred and terminal-marked rows are repaired (#2775)', async () => {
      // The enumeration deliberately includes rows carrying no figure. A
      // figure-only guard skipped exactly those, left the stale
      // `fxIntendedCurrency` standing, and had the child re-stamp the currency
      // the operator moved away from - so the run could never converge.
      const chain = mockClearQueryBuilder(1);

      await repository.clearFxStampForRestatement('ol_order_a');

      const guard = (chain.andWhere.mock.calls as unknown[][])
        .map((call) => String(call[0]))
        .join(' ');
      expect(guard).toContain('"reportingCurrency" IS NOT NULL');
      expect(guard).toContain('"fxIntendedCurrency" IS NOT NULL');
      expect(guard).toContain('"fxStampedAt" IS NOT NULL');
    });

    it('reports false when the row carries no FX state at all, so the clear is idempotent (#2775)', async () => {
      mockClearQueryBuilder(0);

      await expect(repository.clearFxStampForRestatement('ol_order_a')).resolves.toBe(false);
    });

    it('partitions the remaining population by the terminal marker', async () => {
      const addSelect = jest.fn().mockReturnThis();
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect,
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ total: 5, terminal_marked: 3 }),
      });

      await expect(
        repository.countRemainingCurrencyMismatch(baseFilters, 'EUR')
      ).resolves.toEqual({ total: 5, terminalMarked: 3, pending: 2 });

      // `fxStampedAt IS NOT NULL AND reportingCurrency IS NULL` is the ONLY
      // durable evidence of a terminal FX answer — the reason itself is never
      // persisted.
      expect(addSelect).toHaveBeenCalledWith(
        expect.stringContaining('rec."fxStampedAt" IS NOT NULL AND rec."reportingCurrency" IS NULL'),
        'terminal_marked'
      );
    });

    it('coerces bigint-as-string counts so the failure detail cannot concatenate text', async () => {
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ total: '4', terminal_marked: '1' }),
      });

      await expect(
        repository.countRemainingCurrencyMismatch(baseFilters, 'EUR')
      ).resolves.toEqual({ total: 4, terminalMarked: 1, pending: 3 });
    });
  });

  describe('findNetExcludedOrderCandidates (#2465)', () => {
    const baseFilters = {
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: new Date('2026-08-08T00:00:00.000Z'),
    };

    const createCandidateEntity = (
      overrides: Partial<OrderRecordOrmEntity>
    ): OrderRecordOrmEntity => {
      const entity = createOrmEntity();
      Object.assign(entity, overrides);
      return entity;
    };

    it('applies the non-cancelled, current-era-stamped, NOT-net-eligible predicate', async () => {
      const andWhere = jest.fn().mockReturnThis();
      const orderBy = jest.fn().mockReturnThis();
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        andWhere,
        orderBy,
        getMany: jest.fn().mockResolvedValue([]),
      });

      await repository.findNetExcludedOrderCandidates(baseFilters, 'EUR');

      expect(andWhere).toHaveBeenCalledWith(
        expect.stringContaining('rec."cancelledAt" IS NULL AND rec."reportingCurrency" = :currentReportingCurrency AND NOT'),
        { currentReportingCurrency: 'EUR' }
      );
      expect(orderBy).toHaveBeenCalledWith('rec."placedAt"', 'DESC');
    });

    it('is unpaged — no take/skip call on the query builder', async () => {
      const qb: Record<string, jest.Mock> = {
        andWhere: jest.fn(),
        orderBy: jest.fn(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      qb.andWhere.mockReturnValue(qb);
      qb.orderBy.mockReturnValue(qb);
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(qb);

      await repository.findNetExcludedOrderCandidates(baseFilters, 'EUR');

      expect(qb.take).toBeUndefined();
      expect(qb.skip).toBeUndefined();
    });

    it('maps a pre-rollout candidate to the row shape, including taxRateEra', async () => {
      const entity = createCandidateEntity({
        internalOrderId: 'order-pre-rollout',
        sourceConnectionId: 'conn-a',
        placedAt: new Date('2026-08-02T00:00:00.000Z'),
        taxRateEra: 'pre-rollout',
      });
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([entity]),
      });

      const result = await repository.findNetExcludedOrderCandidates(baseFilters, 'EUR');

      expect(result).toEqual([
        {
          internalOrderId: 'order-pre-rollout',
          sourceConnectionId: 'conn-a',
          placedAt: entity.placedAt,
          taxRateEra: 'pre-rollout',
        },
      ]);
    });

    it('maps a non-pre-rollout candidate with taxRateEra: null', async () => {
      const entity = createCandidateEntity({
        internalOrderId: 'order-post-rollout',
        sourceConnectionId: 'conn-a',
        placedAt: new Date('2026-08-03T00:00:00.000Z'),
        taxRateEra: null,
      });
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([entity]),
      });

      const result = await repository.findNetExcludedOrderCandidates(baseFilters, 'EUR');

      expect(result).toEqual([
        {
          internalOrderId: 'order-post-rollout',
          sourceConnectionId: 'conn-a',
          placedAt: entity.placedAt,
          taxRateEra: null,
        },
      ]);
    });

    it('scopes to the sourceConnectionId filter when provided (via the shared analytics scope)', async () => {
      const andWhere = jest.fn().mockReturnThis();
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        andWhere,
        orderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      });

      await repository.findNetExcludedOrderCandidates(
        { ...baseFilters, sourceConnectionId: 'conn-a' },
        'EUR'
      );

      expect(andWhere).toHaveBeenCalledWith('rec.sourceConnectionId = :salesConnectionId', {
        salesConnectionId: 'conn-a',
      });
    });
  });

  describe('findProductMatchingErrorOrders (#2466)', () => {
    const createMappingEntity = (
      overrides: Partial<OrderRecordOrmEntity>
    ): OrderRecordOrmEntity => {
      const entity = createOrmEntity();
      Object.assign(entity, overrides);
      return entity;
    };

    it('applies the source_deleted OR awaiting_mapping predicate, newest-first, with pagination', async () => {
      const andWhere = jest.fn().mockReturnThis();
      const orderBy = jest.fn().mockReturnThis();
      const take = jest.fn().mockReturnThis();
      const skip = jest.fn().mockReturnThis();
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        andWhere,
        orderBy,
        take,
        skip,
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      });

      await repository.findProductMatchingErrorOrders({}, { limit: 20, offset: 40 });

      expect(andWhere).toHaveBeenCalledWith(
        `(rec."recordStatus" = 'source_deleted' OR rec."recordStatus" = 'awaiting_mapping')`
      );
      expect(orderBy).toHaveBeenCalledWith('rec."createdAt"', 'DESC');
      expect(take).toHaveBeenCalledWith(20);
      expect(skip).toHaveBeenCalledWith(40);
    });

    it('scopes to sourceConnectionId/customerId/createdFrom/createdTo when provided', async () => {
      const andWhere = jest.fn().mockReturnThis();
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        andWhere,
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      });
      const createdFrom = new Date('2026-08-01T00:00:00.000Z');
      const createdTo = new Date('2026-08-08T00:00:00.000Z');

      await repository.findProductMatchingErrorOrders(
        { sourceConnectionId: 'conn-a', customerId: 'cust-a', createdFrom, createdTo },
        { limit: 20, offset: 0 }
      );

      expect(andWhere).toHaveBeenCalledWith('rec.sourceConnectionId = :sourceConnectionId', {
        sourceConnectionId: 'conn-a',
      });
      expect(andWhere).toHaveBeenCalledWith('rec.customerId = :customerId', {
        customerId: 'cust-a',
      });
      expect(andWhere).toHaveBeenCalledWith('rec.createdAt >= :createdFrom', { createdFrom });
      expect(andWhere).toHaveBeenCalledWith('rec.createdAt <= :createdTo', { createdTo });
    });

    it('maps an awaiting_mapping row to the row shape', async () => {
      const entity = createMappingEntity({
        internalOrderId: 'order-awaiting-mapping',
        sourceConnectionId: 'conn-a',
        recordStatus: 'awaiting_mapping',
        mappingFailureReason: 'no variant mapping for SKU-123',
        createdAt: new Date('2026-08-02T10:00:00.000Z'),
      });
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[entity], 1]),
      });

      const result = await repository.findProductMatchingErrorOrders({}, { limit: 20, offset: 0 });

      expect(result.total).toBe(1);
      expect(result.items).toEqual([
        {
          internalOrderId: 'order-awaiting-mapping',
          sourceConnectionId: 'conn-a',
          recordStatus: 'awaiting_mapping',
          mappingFailureReason: 'no variant mapping for SKU-123',
          createdAt: entity.createdAt,
          productId: null,
          variantId: null,
        },
      ]);
    });

    it('maps a source_deleted row to the row shape', async () => {
      const entity = createMappingEntity({
        internalOrderId: 'order-source-deleted',
        sourceConnectionId: 'conn-a',
        recordStatus: 'source_deleted',
        mappingFailureReason: 'variant deleted at master',
        createdAt: new Date('2026-08-03T10:00:00.000Z'),
      });
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[entity], 1]),
      });

      const result = await repository.findProductMatchingErrorOrders({}, { limit: 20, offset: 0 });

      expect(result.items[0].recordStatus).toBe('source_deleted');
    });

    it('returns an empty page when nothing matches (backs the all-clear mockup state)', async () => {
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      });

      const result = await repository.findProductMatchingErrorOrders({}, { limit: 20, offset: 0 });

      expect(result).toEqual({ items: [], total: 0 });
    });
  });

  describe('getMedianOrderValue (#1987)', () => {
    const baseFilters = {
      from: new Date('2026-08-01T00:00:00.000Z'),
      to: new Date('2026-08-08T00:00:00.000Z'),
    };

    it('returns the parsed median when a row matches', async () => {
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ median: '98.00' }),
      });

      const result = await repository.getMedianOrderValue(baseFilters, 'EUR');

      expect(result).toBe(98);
    });

    it('returns null when no row matches (empty ordered-set aggregate)', async () => {
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ median: null }),
      });

      const result = await repository.getMedianOrderValue(baseFilters, 'EUR');

      expect(result).toBeNull();
    });

    it('excludes cancelled orders', async () => {
      const andWhere = jest.fn().mockReturnThis();
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        andWhere,
        getRawOne: jest.fn().mockResolvedValue({ median: null }),
      });

      await repository.getMedianOrderValue(baseFilters, 'EUR');

      expect(andWhere).toHaveBeenCalledWith('rec."cancelledAt" IS NULL');
    });

    it('excludes non-current-era orders (#1987 review notes, ported from #2172)', async () => {
      const andWhere = jest.fn().mockReturnThis();
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        andWhere,
        getRawOne: jest.fn().mockResolvedValue({ median: null }),
      });

      await repository.getMedianOrderValue(baseFilters, 'EUR');

      expect(andWhere).toHaveBeenCalledWith('rec."reportingCurrency" = :currentReportingCurrency', {
        currentReportingCurrency: 'EUR',
      });
    });
  });

  describe('upsert', () => {
    it('should create new order record', async () => {
      const domainEntity = createDomainEntity();
      const savedEntity = createOrmEntity();
      ormRepository.save.mockResolvedValue(savedEntity);

      const result = await repository.upsert(domainEntity);

      expect(result).toBeDefined();
      expect(result.internalOrderId).toBe('order-123');
      expect(ormRepository.save).toHaveBeenCalledTimes(1);
    });

    it('should update existing order record', async () => {
      const domainEntity = createDomainEntity();
      const existingEntity = createOrmEntity();
      existingEntity.updatedAt = new Date('2025-01-02T10:00:00Z');
      ormRepository.save.mockResolvedValue(existingEntity);

      const result = await repository.upsert(domainEntity);

      expect(result).toBeDefined();
      expect(ormRepository.save).toHaveBeenCalledTimes(1);
    });

    it('should NOT write syncStatus even when the domain record carries one (#2140)', async () => {
      // Guards against a future caller reintroducing the clobber by passing
      // destination sync state through the ingestion path. updateSyncStatus is
      // the sole writer; a full-object save() that carries this column resets
      // the per-destination rows it committed.
      const syncStatus: OrderSyncStatus[] = [
        {
          destinationConnectionId: 'dest-connection-789',
          status: 'synced',
          syncedAt: new Date('2025-01-01T11:00:00Z'),
          externalOrderId: 'external-order-999',
          externalOrderNumber: 'EXT-001',
        },
      ];
      const domainEntity = new OrderRecord(
        'order-123',
        'customer-456',
        'source-connection-123',
        'event-456',
        {
          id: 'order-123',
          orderNumber: 'ORD-001',
          status: 'pending',
        },
        syncStatus,
        'ready',
        new Date('2025-01-01T10:00:00Z'),
        new Date('2025-01-01T10:00:00Z')
      );
      const savedEntity = createOrmEntity();
      ormRepository.save.mockResolvedValue(savedEntity);

      await repository.upsert(domainEntity);

      const callArg = ormRepository.save.mock.calls[0][0] as OrderRecordOrmEntity;
      expect(callArg.syncStatus).toBeUndefined();
    });

    it('should map recordStatus to ORM entity on toOrm path', async () => {
      const domainEntity = new OrderRecord(
        'order-123',
        null,
        'conn-123',
        null,
        {},
        [],
        'awaiting_mapping',
        new Date(),
        new Date()
      );
      const savedEntity = createOrmEntity();
      ormRepository.save.mockResolvedValue(savedEntity);

      await repository.upsert(domainEntity);

      const callArg = ormRepository.save.mock.calls[0][0] as OrderRecordOrmEntity;
      expect(callArg.recordStatus).toBe('awaiting_mapping');
    });

    it('should read cancelledAt back via toDomain when present on the ORM row', async () => {
      const cancelledAt = new Date('2026-08-01T12:00:00Z');
      const savedEntity = createOrmEntity();
      savedEntity.cancelledAt = cancelledAt;
      ormRepository.save.mockResolvedValue(savedEntity);

      const result = await repository.upsert(createDomainEntity());

      expect(result.cancelledAt).toBe(cancelledAt);
    });

    it('should NOT include cancelledAt in the entity passed to save() (#1984)', async () => {
      // upsert() is a full-object save() with no per-order lock around it, so
      // writing cancelledAt here would race with the atomic, COALESCE-based
      // markCancelled() a concurrent cancel-event call may commit at the same
      // time. Leaving the property unset lets TypeORM omit the column from
      // the generated UPDATE entirely — markCancelled is the sole writer.
      const domainEntity = createDomainEntity();
      ormRepository.save.mockResolvedValue(createOrmEntity());

      await repository.upsert(domainEntity);

      const callArg = ormRepository.save.mock.calls[0][0] as OrderRecordOrmEntity;
      expect(callArg.cancelledAt).toBeUndefined();
    });

    it('should NOT include fulfillmentState in the entity passed to save() (#2101)', async () => {
      // The ingestion path never carries a fulfillment rollup, so writing the
      // column here reset a `'dispatched'` order to NULL on every re-poll.
      // Leaving the property unset lets TypeORM omit the column from the
      // generated UPDATE - updateFulfillmentState is the sole writer.
      ormRepository.save.mockResolvedValue(createOrmEntity());

      await repository.upsert(createDomainEntity());

      const callArg = ormRepository.save.mock.calls[0][0] as OrderRecordOrmEntity;
      expect(callArg.fulfillmentState).toBeUndefined();
    });

    it('should NOT write fulfillmentState even when the domain record carries one', async () => {
      // Guards against a future caller reintroducing the clobber by passing a
      // rollup value through the ingestion path.
      const domainEntity = new OrderRecord(
        'order-123',
        null,
        'conn-123',
        null,
        {},
        [],
        'ready',
        new Date('2025-01-01T10:00:00Z'),
        new Date('2025-01-01T10:00:00Z'),
        [],
        null,
        'dispatched'
      );
      ormRepository.save.mockResolvedValue(createOrmEntity());

      await repository.upsert(domainEntity);

      const callArg = ormRepository.save.mock.calls[0][0] as OrderRecordOrmEntity;
      expect(callArg.fulfillmentState).toBeUndefined();
    });

    it('should read fulfillmentState back via toDomain when present on the ORM row', async () => {
      const savedEntity = createOrmEntity();
      savedEntity.fulfillmentState = 'dispatched';
      ormRepository.save.mockResolvedValue(savedEntity);

      const result = await repository.upsert(createDomainEntity());

      expect(result.fulfillmentState).toBe('dispatched');
    });

    it('should NOT include syncStatus or syncAttempts in the entity passed to save() (#2140)', async () => {
      // The ingestion path never carries destination sync state, so writing
      // these columns wiped the per-destination rows and the whole attempt
      // history on every re-poll. Leaving the properties unset lets TypeORM omit
      // both columns from the generated statement - updateSyncStatus is the sole
      // writer, and Postgres fills an omitted column on INSERT from its
      // `DEFAULT '[]'`.
      ormRepository.save.mockResolvedValue(createOrmEntity());

      await repository.upsert(createDomainEntity());

      const callArg = ormRepository.save.mock.calls[0][0] as OrderRecordOrmEntity;
      expect(callArg.syncStatus).toBeUndefined();
      expect(callArg.syncAttempts).toBeUndefined();
    });

    it('should NOT write syncAttempts even when the domain record carries history', async () => {
      const attempts: SyncAttempt[] = [
        {
          destinationConnectionId: 'dest-connection-789',
          status: 'failed',
          attemptedAt: new Date('2025-01-01T11:00:00Z'),
          error: 'destination timeout',
        },
      ];
      const domainEntity = new OrderRecord(
        'order-123',
        null,
        'conn-123',
        null,
        {},
        [],
        'ready',
        new Date('2025-01-01T10:00:00Z'),
        new Date('2025-01-01T10:00:00Z'),
        attempts
      );
      ormRepository.save.mockResolvedValue(createOrmEntity());

      await repository.upsert(domainEntity);

      const callArg = ormRepository.save.mock.calls[0][0] as OrderRecordOrmEntity;
      expect(callArg.syncAttempts).toBeUndefined();
    });

    it('should report both columns empty when save() hands back the entity it was given', async () => {
      // The update path has no RETURNING clause, so the entity TypeORM returns
      // still carries the unset properties. toDomain must read that as "not part
      // of this statement" rather than throwing on `undefined.map`.
      const unsetEntity = createOrmEntity();
      delete (unsetEntity as Partial<OrderRecordOrmEntity>).syncStatus;
      delete (unsetEntity as Partial<OrderRecordOrmEntity>).syncAttempts;
      ormRepository.save.mockResolvedValue(unsetEntity);

      const result = await repository.upsert(createDomainEntity());

      expect(result.syncStatus).toEqual([]);
      expect(result.syncAttempts).toEqual([]);
    });
  });

  describe('upsertWithLineItems (#1985)', () => {
    it('saves the order record and inserts the derived line items in one transaction', async () => {
      const domainEntity = createDomainEntity();
      const savedEntity = createOrmEntity();
      transactionalManager.save.mockResolvedValue(savedEntity);
      transactionalManager.delete.mockResolvedValue(undefined);

      const result = await repository.upsertWithLineItems(domainEntity, [
        {
          lineNumber: 0,
          productId: 'ol_product_1',
          variantId: 'ol_variant_1',
          quantity: 2,
          unitPrice: 10,
          sourceConnectionId: 'conn-123',
          placedAt: null,
          // #2250 — transcribed from the snapshot; null here is the honest
          // pre-rollout shape, not a default.
          taxRate: null,
          taxSource: null,
          taxRateReadAt: null,
        },
      ]);

      expect(result.internalOrderId).toBe('order-123');
      // save() is called twice inside the transaction: once for the order
      // record, once for the line-item batch — both on the SAME manager.
      expect(transactionalManager.save).toHaveBeenCalledTimes(2);
      expect(transactionalManager.delete).toHaveBeenCalledWith(expect.anything(), {
        orderRecordId: 'order-123',
      });
    });

    it('deletes the prior line-item set even when the new set is empty (order re-ingested with no items)', async () => {
      const domainEntity = createDomainEntity();
      const savedEntity = createOrmEntity();
      transactionalManager.save.mockResolvedValue(savedEntity);
      transactionalManager.delete.mockResolvedValue(undefined);

      await repository.upsertWithLineItems(domainEntity, []);

      expect(transactionalManager.delete).toHaveBeenCalledWith(expect.anything(), {
        orderRecordId: 'order-123',
      });
      // Only the order-record save runs — no line-item save call for an empty set.
      expect(transactionalManager.save).toHaveBeenCalledTimes(1);
    });

    it('propagates a failure from either write so the caller sees the transaction as failed', async () => {
      const domainEntity = createDomainEntity();
      transactionalManager.save.mockRejectedValue(new Error('db error'));

      await expect(repository.upsertWithLineItems(domainEntity, [])).rejects.toThrow('db error');
    });

    it('includes the four analytics scalars (#1985 review, finding 1) in the entity passed to save()', async () => {
      // upsertWithLineItems() is the sole writer of these four columns — see
      // the `toOrm` describe block below, which asserts the sibling upsert()
      // path (persistIncomingSnapshot) does NOT touch them.
      const domainEntity = new OrderRecord(
        'order-123',
        'customer-456',
        'source-connection-123',
        'event-456',
        { id: 'order-123', orderNumber: 'ORD-001', status: 'pending' },
        [],
        'ready',
        new Date('2025-01-01T10:00:00Z'),
        new Date('2025-01-01T10:00:00Z'),
        [],
        null,
        null,
        null,
        new Date('2025-01-01T09:00:00Z'),
        'PLN',
        'inclusive',
        199.99
      );
      transactionalManager.save.mockResolvedValue(createOrmEntity());
      transactionalManager.delete.mockResolvedValue(undefined);

      await repository.upsertWithLineItems(domainEntity, []);

      const callArg = transactionalManager.save.mock.calls[0][1] as OrderRecordOrmEntity;
      expect(callArg.placedAt).toEqual(new Date('2025-01-01T09:00:00Z'));
      expect(callArg.currency).toBe('PLN');
      expect(callArg.taxTreatment).toBe('inclusive');
      expect(callArg.totalAmount).toBe(199.99);
    });

    /**
     * The middle state (`''` = the source asserted the buyer has no tax id) is
     * the one a well-meaning edit destroys. A `|| null` or a `.trim()` on the
     * write line, or a `|| null` on the read, collapses it into "not asserted"
     * while every three-state unit test on the pure helpers stays green,
     * because those never touch this repository. So each state is pinned here,
     * through the real write and the real read.
     */
    it.each([
      ['a tax id', '1234567890', '1234567890'],
      ['asserted-none', '', ''],
      ['not asserted', null, null],
    ])(
      'round-trips buyerTaxId in the %s state through save() and toDomain() (#2599 review, finding 4)',
      async (_label, stored: string | null, expected: string | null) => {
        const domainEntity = new OrderRecord(
          'order-123',
          'customer-456',
          'source-connection-123',
          'event-456',
          { id: 'order-123', orderNumber: 'ORD-001', status: 'pending' },
          [],
          'ready',
          new Date('2025-01-01T10:00:00Z'),
          new Date('2025-01-01T10:00:00Z'),
          [],
          null,
          null,
          null,
          new Date('2025-01-01T09:00:00Z'),
          'PLN',
          'inclusive',
          199.99,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          stored
        );
        const savedOrm = createOrmEntity();
        savedOrm.buyerTaxId = stored;
        transactionalManager.save.mockResolvedValue(savedOrm);
        transactionalManager.delete.mockResolvedValue(undefined);

        await repository.upsertWithLineItems(domainEntity, []);

        const callArg = transactionalManager.save.mock.calls[0][1] as OrderRecordOrmEntity;
        expect(callArg.buyerTaxId).toBe(stored);

        ormRepository.findOne.mockResolvedValue(savedOrm);
        const read = await repository.findById('order-123');
        expect(read?.buyerTaxId).toBe(expected);
      }
    );

    it('decodes the round-tripped column back to the three domain states', async () => {
      const withColumn = (stored: string | null): OrderRecordOrmEntity => {
        const entity = createOrmEntity();
        entity.buyerTaxId = stored;
        return entity;
      };

      ormRepository.findOne.mockResolvedValue(withColumn('1234567890'));
      expect((await repository.findById('order-123'))?.buyerTaxIdState).toBe('1234567890');

      ormRepository.findOne.mockResolvedValue(withColumn(''));
      expect((await repository.findById('order-123'))?.buyerTaxIdState).toBeNull();

      ormRepository.findOne.mockResolvedValue(withColumn(null));
      expect((await repository.findById('order-123'))?.buyerTaxIdState).toBeUndefined();
    });
  });

  describe('findMany', () => {
    it('should return all records when no recordStatus filter is provided', async () => {
      const entity = createOrmEntity();
      const andWhere = jest.fn().mockReturnThis();
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        andWhere,
        getManyAndCount: jest.fn().mockResolvedValue([[entity], 1]),
      });

      const result = await repository.findMany({}, { limit: 20, offset: 0 });

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      const calls = andWhere.mock.calls.map((c: unknown[]) => c[0] as string);
      expect(calls.some((c) => c.includes('recordStatus'))).toBe(false);
    });

    it('should add recordStatus WHERE clause when filter is provided', async () => {
      const andWhere = jest.fn().mockReturnThis();
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        andWhere,
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      });

      await repository.findMany({ recordStatus: 'awaiting_mapping' }, { limit: 20, offset: 0 });

      expect(andWhere).toHaveBeenCalledWith('rec.recordStatus = :recordStatus', {
        recordStatus: 'awaiting_mapping',
      });
    });

    it('should add cancelledAt IS NOT NULL when cancelled=true (#1984)', async () => {
      const andWhere = jest.fn().mockReturnThis();
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        andWhere,
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      });

      await repository.findMany({ cancelled: true }, { limit: 20, offset: 0 });

      expect(andWhere).toHaveBeenCalledWith('rec.cancelledAt IS NOT NULL');
    });

    it('should add cancelledAt IS NULL when cancelled=false (#1984)', async () => {
      const andWhere = jest.fn().mockReturnThis();
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        andWhere,
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      });

      await repository.findMany({ cancelled: false }, { limit: 20, offset: 0 });

      expect(andWhere).toHaveBeenCalledWith('rec.cancelledAt IS NULL');
    });

    it('should never emit an empty IN () for the salesDocumentBlocked predicate (#2100)', async () => {
      // IS_SALES_DOCUMENT_BLOCKED is built from SalesDocumentAttentionReasonValues at
      // class-definition time — an empty array would compile to `IN ()`, a Postgres
      // syntax error surfaced as a runtime 500 on the orders list rather than a type
      // error. Piotr's review round (#2129) flagged this as cheap insurance worth
      // pinning even though the exact-membership spec on the values array itself
      // would also fail first.
      const andWhere = jest.fn().mockReturnThis();
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        andWhere,
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      });

      await repository.findMany({ salesDocumentBlocked: true }, { limit: 20, offset: 0 });

      const predicate = andWhere.mock.calls
        .map((c: unknown[]) => c[0] as string)
        .find((c) => c.includes('salesDocumentBlockReason'));
      expect(predicate).toBeDefined();
      expect(predicate).not.toContain('IN ()');
    });
  });

  describe('updateSyncStatus', () => {
    // The current-state upsert + per-destination append + cap is implemented
    // as a single SQL statement and is covered end-to-end by the integration
    // test in apps/api/test/integration/order-record-attempts.int-spec.ts.
    // The unit test here only guards the not-found branch — the only path the
    // integration test can't cheaply express.
    it('should map recordStatus from ORM to domain on toDomain path', async () => {
      const entity = createOrmEntity();
      entity.recordStatus = 'awaiting_mapping';
      ormRepository.findOne.mockResolvedValue(entity);

      const result = await repository.findById('order-123');

      expect(result?.recordStatus).toBe('awaiting_mapping');
    });

    it('should throw OrderRecordNotFoundException when no row matches', async () => {
      // pg drivers return [rows, affected] from raw UPDATE; TypeORM forwards.
      (ormRepository.query as jest.Mock).mockResolvedValue([[], 0]);

      const newStatus: OrderSyncStatus = {
        destinationConnectionId: 'dest-connection-789',
        status: 'synced',
      };
      const newAttempt: SyncAttempt = {
        destinationConnectionId: 'dest-connection-789',
        status: 'synced',
        attemptedAt: new Date('2025-01-01T11:00:00Z'),
      };

      await expect(
        repository.updateSyncStatus(
          'non-existent-order',
          'dest-connection-789',
          newStatus,
          newAttempt
        )
      ).rejects.toThrow(OrderRecordNotFoundException);
    });
  });

  describe('markCancelled (#1984)', () => {
    it('should issue a COALESCE update carrying the given instant and order id', async () => {
      (ormRepository.query as jest.Mock).mockResolvedValue([[], 1]);
      const cancelledAt = new Date('2026-08-11T09:00:00Z');

      await repository.markCancelled('order-123', cancelledAt);

      expect(ormRepository.query).toHaveBeenCalledWith(
        expect.stringContaining('COALESCE("cancelledAt", $1)'),
        [cancelledAt, 'order-123']
      );
    });

    it('should not throw when no row matches the given order id', async () => {
      (ormRepository.query as jest.Mock).mockResolvedValue([[], 0]);

      await expect(
        repository.markCancelled('non-existent-order', new Date())
      ).resolves.toBeUndefined();
    });
  });

  describe('FX snapshot (#2124)', () => {
    const buildUpdateResult = (affected: number): UpdateResult =>
      ({ affected, raw: [], generatedMaps: [] }) as UpdateResult;

    const stamp = {
      reportingCurrency: 'EUR',
      reportingTotalAmount: 425,
      exchangeRateId: 'e1f0c0de-0000-4000-8000-000000000001',
      fxRule: 'prev-business-day',
      fxStampedAt: new Date('2026-08-14T09:00:00Z'),
    } as const;

    describe('claimFxIntentIfAbsent', () => {
      it('should guard the write on fxIntendedCurrency IS NULL and write only the intent', async () => {
        (ormRepository.update as jest.Mock).mockResolvedValue(buildUpdateResult(1));

        const won = await repository.claimFxIntentIfAbsent('order-123', {
          reportingCurrency: 'EUR',
          fxRule: 'prev-business-day',
        });

        expect(won).toBe(true);
        expect(ormRepository.update).toHaveBeenCalledWith(
          { internalOrderId: 'order-123', fxIntendedCurrency: IsNull() },
          { fxIntendedCurrency: 'EUR', fxRule: 'prev-business-day' }
        );
      });

      it('should report the claim lost when an intent already exists', async () => {
        // The loser re-reads and adopts the winner's intent — two concurrent
        // first attempts must never pin different currencies for one order.
        (ormRepository.update as jest.Mock).mockResolvedValue(buildUpdateResult(0));

        await expect(
          repository.claimFxIntentIfAbsent('order-123', {
            reportingCurrency: 'PLN',
            fxRule: 'prev-business-day',
          })
        ).resolves.toBe(false);
      });

      it('should treat a missing affected count as a lost claim', async () => {
        (ormRepository.update as jest.Mock).mockResolvedValue({
          raw: [],
          generatedMaps: [],
        } as UpdateResult);

        await expect(
          repository.claimFxIntentIfAbsent('order-123', {
            reportingCurrency: 'EUR',
            fxRule: 'prev-business-day',
          })
        ).resolves.toBe(false);
      });
    });

    describe('stampFxIfAbsent', () => {
      it('should guard on reportingCurrency IS NULL and write all five stamp columns at once', async () => {
        (ormRepository.update as jest.Mock).mockResolvedValue(buildUpdateResult(1));

        const stamped = await repository.stampFxIfAbsent('order-123', stamp);

        expect(stamped).toBe(true);
        expect(ormRepository.update).toHaveBeenCalledWith(
          { internalOrderId: 'order-123', reportingCurrency: IsNull() },
          {
            reportingCurrency: 'EUR',
            reportingTotalAmount: 425,
            exchangeRateId: 'e1f0c0de-0000-4000-8000-000000000001',
            fxRule: 'prev-business-day',
            fxStampedAt: stamp.fxStampedAt,
          }
        );
      });

      it('should NOT guard on fxIntendedCurrency, which is populated by then', async () => {
        (ormRepository.update as jest.Mock).mockResolvedValue(buildUpdateResult(1));

        await repository.stampFxIfAbsent('order-123', stamp);

        const [where] = (ormRepository.update as jest.Mock).mock.calls[0] as [
          Record<string, unknown>,
        ];
        expect(where).not.toHaveProperty('fxIntendedCurrency');
      });

      it('should report false and write nothing further when a stamp already exists', async () => {
        (ormRepository.update as jest.Mock).mockResolvedValue(buildUpdateResult(0));

        await expect(repository.stampFxIfAbsent('order-123', stamp)).resolves.toBe(false);
      });

      it('should keep exchangeRateId null on the same-currency path', async () => {
        (ormRepository.update as jest.Mock).mockResolvedValue(buildUpdateResult(1));

        await repository.stampFxIfAbsent('order-123', { ...stamp, exchangeRateId: null });

        const [, values] = (ormRepository.update as jest.Mock).mock.calls[0] as [
          unknown,
          Record<string, unknown>,
        ];
        expect(values.exchangeRateId).toBeNull();
        expect(values.reportingCurrency).toBe('EUR');
      });
    });

    describe('markFxTerminal (#2135 review, finding 1)', () => {
      it('should guard ONLY on reportingCurrency IS NULL so a re-answer can move the marker', async () => {
        // No `fxStampedAt: IsNull()` predicate, deliberately. The sweep re-admits a
        // terminal-but-figureless row once its marker ages past the cooldown, so a
        // second terminal answer has to move the marker forward - otherwise the row
        // would be re-tried on every subsequent tick instead of once per cooldown.
        (ormRepository.update as jest.Mock).mockResolvedValue(buildUpdateResult(1));
        const at = new Date('2026-08-20T10:00:00Z');

        await expect(repository.markFxTerminal('order-123', at)).resolves.toBe(true);
        expect(ormRepository.update).toHaveBeenCalledWith(
          { internalOrderId: 'order-123', reportingCurrency: IsNull() },
          { fxStampedAt: at }
        );

        const [where] = (ormRepository.update as jest.Mock).mock.calls[0] as [
          Record<string, unknown>,
        ];
        expect(where).not.toHaveProperty('fxStampedAt');
      });

      it('should write nothing for a row that already carries a figure', async () => {
        // The immutability that matters: a stamped row is untouchable here whatever
        // its timestamp says.
        (ormRepository.update as jest.Mock).mockResolvedValue(buildUpdateResult(0));

        await expect(
          repository.markFxTerminal('order-123', new Date('2026-08-20T10:00:00Z'))
        ).resolves.toBe(false);
      });
    });

    describe('findUnstampedFxOrderIds (#2135 review, finding 1)', () => {
      it('should OR an unanswered arm with a cooled-down terminal arm, both keyed on no figure', async () => {
        (ormRepository.find as jest.Mock).mockResolvedValue([{ internalOrderId: 'order-1' }]);
        const createdSince = new Date('2026-07-01T00:00:00Z');
        const terminalRetryBefore = new Date('2026-08-13T00:00:00Z');

        const ids = await repository.findUnstampedFxOrderIds('conn-1', {
          limit: 25,
          createdSince,
          terminalRetryBefore,
        });

        expect(ids).toEqual(['order-1']);
        const [options] = (ormRepository.find as jest.Mock).mock.calls[0] as [
          { where: Record<string, unknown>[]; take: number },
        ];
        expect(options.take).toBe(25);
        expect(options.where).toHaveLength(2);
        // `reportingCurrency IS NULL` in BOTH arms is the invariant that keeps a
        // stamped row out of the frontier no matter how old its marker is.
        for (const arm of options.where) {
          expect(arm).toMatchObject({
            sourceConnectionId: 'conn-1',
            reportingCurrency: IsNull(),
            createdAt: MoreThanOrEqual(createdSince),
          });
        }
        expect(options.where[0]).toMatchObject({ fxStampedAt: IsNull() });
        expect(options.where[1]).toMatchObject({
          fxStampedAt: LessThan(terminalRetryBefore),
        });
      });
    });

    describe('listDistinctNativeCurrencies', () => {
      it('should emit the jsonb_typeof-guarded expression with no LIMIT and no ordering', async () => {
        (ormRepository.query as jest.Mock).mockResolvedValue([{ currency: 'PLN' }]);

        await repository.listDistinctNativeCurrencies();

        const [sql] = (ormRepository.query as jest.Mock).mock.calls[0] as [string];
        expect(sql).toContain(`jsonb_typeof(rec."orderSnapshot"#>'{totals,currency}') = 'string'`);
        expect(sql).toContain(`rec."orderSnapshot"#>>'{totals,currency}'`);
        expect(sql).toContain('SELECT DISTINCT');
        expect(sql).not.toContain('LIMIT');
        expect(sql).not.toContain('ORDER BY');
      });

      it('should return a de-duplicated set of currency codes', async () => {
        (ormRepository.query as jest.Mock).mockResolvedValue([
          { currency: 'PLN' },
          { currency: 'EUR' },
          { currency: 'PLN' },
        ]);

        const result = await repository.listDistinctNativeCurrencies();

        expect(result).toEqual(['PLN', 'EUR']);
      });

      it('should skip non-string values rather than leak them into the set', async () => {
        (ormRepository.query as jest.Mock).mockResolvedValue([
          { currency: 'PLN' },
          { currency: null },
          { currency: 7 },
          {},
        ]);

        const result = await repository.listDistinctNativeCurrencies();

        expect(result).toEqual(['PLN']);
      });

      it('should return [] when the driver hands back a non-array', async () => {
        (ormRepository.query as jest.Mock).mockResolvedValue(undefined);

        await expect(repository.listDistinctNativeCurrencies()).resolves.toEqual([]);
      });
    });

    describe('toOrm', () => {
      it('should NOT include any of the six FX columns in the entity passed to save()', async () => {
        // upsert() is a full-row save() on an update-or-create ingestion path,
        // so mapping these columns would let a re-poll of an already-stamped
        // order write `null` over a reported financial figure. Leaving the
        // properties unset makes TypeORM omit the columns from the UPDATE —
        // claimFxIntentIfAbsent / stampFxIfAbsent are their only writers.
        ormRepository.save.mockResolvedValue(createOrmEntity());

        await repository.upsert(createDomainEntity());

        const callArg = ormRepository.save.mock.calls[0][0] as OrderRecordOrmEntity;
        expect(callArg.reportingCurrency).toBeUndefined();
        expect(callArg.reportingTotalAmount).toBeUndefined();
        expect(callArg.exchangeRateId).toBeUndefined();
        expect(callArg.fxRule).toBeUndefined();
        expect(callArg.fxStampedAt).toBeUndefined();
        expect(callArg.fxIntendedCurrency).toBeUndefined();
      });

      it('should NOT write the FX columns even when the domain record carries a stamp', async () => {
        // Guards against a future caller reintroducing the clobber by threading
        // a stamped record back through the ingestion path.
        const stamped = new OrderRecord(
          'order-123',
          null,
          'conn-123',
          null,
          {},
          [],
          'ready',
          new Date('2026-08-01T10:00:00Z'),
          new Date('2026-08-01T10:00:00Z'),
          [],
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          'EUR',
          425,
          'e1f0c0de-0000-4000-8000-000000000001',
          'prev-business-day',
          new Date('2026-08-14T09:00:00Z'),
          'EUR'
        );
        ormRepository.save.mockResolvedValue(createOrmEntity());

        await repository.upsert(stamped);

        const callArg = ormRepository.save.mock.calls[0][0] as OrderRecordOrmEntity;
        expect(callArg.reportingCurrency).toBeUndefined();
        expect(callArg.reportingTotalAmount).toBeUndefined();
        expect(callArg.exchangeRateId).toBeUndefined();
        expect(callArg.fxRule).toBeUndefined();
        expect(callArg.fxStampedAt).toBeUndefined();
        expect(callArg.fxIntendedCurrency).toBeUndefined();
      });

      it('should NOT include the four analytics scalars (#1985 review, finding 1) in the entity passed to save() via upsert()', async () => {
        // upsert() is reached by persistIncomingSnapshot, whose OrderRecord
        // never carries a resolved analytics figure. Mapping these columns
        // here would NULL out an already-`ready` order's figures on every
        // re-poll (transient), and leave them permanently NULL once item
        // resolution starts failing (permanent) — upsertWithLineItems() is
        // their sole writer instead.
        ormRepository.save.mockResolvedValue(createOrmEntity());

        await repository.upsert(createDomainEntity());

        const callArg = ormRepository.save.mock.calls[0][0] as OrderRecordOrmEntity;
        expect(callArg.placedAt).toBeUndefined();
        expect(callArg.currency).toBeUndefined();
        expect(callArg.taxTreatment).toBeUndefined();
        expect(callArg.totalAmount).toBeUndefined();
      });

      it('should NOT write the analytics scalars via upsert() even when the domain record carries them', async () => {
        // Guards against a future caller reintroducing the clobber by
        // threading an already-resolved OrderRecord back through
        // persistIncomingSnapshot's upsert() path.
        const withScalars = new OrderRecord(
          'order-123',
          null,
          'conn-123',
          null,
          {},
          [],
          'awaiting_mapping',
          new Date('2026-08-01T10:00:00Z'),
          new Date('2026-08-01T10:00:00Z'),
          [],
          null,
          null,
          null,
          new Date('2026-08-01T09:00:00Z'),
          'EUR',
          'exclusive',
          425
        );
        ormRepository.save.mockResolvedValue(createOrmEntity());

        await repository.upsert(withScalars);

        const callArg = ormRepository.save.mock.calls[0][0] as OrderRecordOrmEntity;
        expect(callArg.placedAt).toBeUndefined();
        expect(callArg.currency).toBeUndefined();
        expect(callArg.taxTreatment).toBeUndefined();
        expect(callArg.totalAmount).toBeUndefined();
      });
    });

    describe('toDomain', () => {
      it('should hydrate the six FX columns, Number()-ing the numeric total', async () => {
        const entity = createOrmEntity();
        entity.reportingCurrency = 'EUR';
        // pg returns `numeric` as a string; the column's TS type is `number`.
        entity.reportingTotalAmount = '425.00' as unknown as number;
        entity.exchangeRateId = 'e1f0c0de-0000-4000-8000-000000000001';
        entity.fxRule = 'prev-business-day';
        entity.fxStampedAt = new Date('2026-08-14T09:00:00Z');
        entity.fxIntendedCurrency = 'EUR';
        ormRepository.findOne.mockResolvedValue(entity);

        const result = await repository.findById('order-123');

        expect(result?.reportingCurrency).toBe('EUR');
        expect(result?.reportingTotalAmount).toBe(425);
        expect(result?.exchangeRateId).toBe('e1f0c0de-0000-4000-8000-000000000001');
        expect(result?.fxRule).toBe('prev-business-day');
        expect(result?.fxStampedAt).toEqual(new Date('2026-08-14T09:00:00Z'));
        expect(result?.fxIntendedCurrency).toBe('EUR');
      });

      it('should keep an unstamped row null rather than coercing the total to 0', async () => {
        const entity = createOrmEntity();
        ormRepository.findOne.mockResolvedValue(entity);

        const result = await repository.findById('order-123');

        expect(result?.reportingCurrency).toBeNull();
        expect(result?.reportingTotalAmount).toBeNull();
        expect(result?.exchangeRateId).toBeNull();
        expect(result?.fxRule).toBeNull();
        expect(result?.fxStampedAt).toBeNull();
        expect(result?.fxIntendedCurrency).toBeNull();
      });

      it('should hydrate an intent-only row without reporting it as stamped', async () => {
        // The deferred state: fxRule + fxIntendedCurrency set while the stamp
        // columns are still NULL. `reportingCurrency IS NULL` is the canonical
        // "unstamped" test.
        const entity = createOrmEntity();
        entity.fxRule = 'prev-business-day';
        entity.fxIntendedCurrency = 'EUR';
        ormRepository.findOne.mockResolvedValue(entity);

        const result = await repository.findById('order-123');

        expect(result?.fxIntendedCurrency).toBe('EUR');
        expect(result?.fxRule).toBe('prev-business-day');
        expect(result?.reportingCurrency).toBeNull();
        expect(result?.fxStampedAt).toBeNull();
      });
    });
  });

  describe('patchSnapshotTaxRates', () => {
    it('guards the whole write on the absence of the taxRate key alone (#2440)', async () => {
      (ormRepository.query as jest.Mock).mockResolvedValue(undefined);
      const readAt = new Date('2026-08-24T00:00:00.000Z');

      await repository.patchSnapshotTaxRates('ol_order_1', 2, {
        taxRate: '23',
        taxSource: 'backfill',
        taxRateReadAt: readAt,
      });

      expect(ormRepository.query).toHaveBeenCalledTimes(1);
      const [sql, params] = (ormRepository.query as jest.Mock).mock.calls[0] as [string, unknown[]];
      expect(sql).toMatch(/NOT\s*\(\s*"orderSnapshot"#>ARRAY\['items',\s*\$1\]\s*\?\s*'taxRate'\s*\)/);
      expect(sql).toMatch(/jsonb_typeof\("orderSnapshot"#>ARRAY\['items',\s*\$1\]\)\s*=\s*'object'/);
      expect(params).toEqual(['2', '23', 'backfill', readAt.toISOString(), 'ol_order_1']);
    });

    it('never touches any snapshot key other than the three tax fields', async () => {
      (ormRepository.query as jest.Mock).mockResolvedValue(undefined);

      await repository.patchSnapshotTaxRates('ol_order_1', 0, {
        taxRate: 'zw',
        taxSource: 'backfill',
        taxRateReadAt: new Date('2026-08-24T00:00:00.000Z'),
      });

      const [sql] = (ormRepository.query as jest.Mock).mock.calls[0] as [string];
      const setClauseOnly = sql.slice(sql.indexOf('SET'), sql.indexOf('WHERE'));
      for (const key of ['taxRate', 'taxSource', 'taxRateReadAt']) {
        expect(setClauseOnly).toContain(`'${key}'`);
      }
      const pathKeyMatches = [...setClauseOnly.matchAll(/'items',\s*\$1,\s*'([a-zA-Z]+)'/g)].map(
        (m) => m[1]
      );
      expect(new Set(pathKeyMatches)).toEqual(new Set(['taxRate', 'taxSource', 'taxRateReadAt']));
    });
  });

  describe('countOrdersByRoutingCountrySince (#2518, ADR-066)', () => {
    function stubQueryBuilder(rows: { country: string; order_count: string }[]): {
      select: jest.Mock;
      addSelect: jest.Mock;
      where: jest.Mock;
      andWhere: jest.Mock;
      groupBy: jest.Mock;
      orderBy: jest.Mock;
      addOrderBy: jest.Mock;
      getRawMany: jest.Mock;
    } {
      const parts = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(rows),
      };
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue(parts);
      return parts;
    }

    it('should issue ONE grouped query, never one per country', async () => {
      stubQueryBuilder([
        { country: 'PL', order_count: '47' },
        { country: 'DE', order_count: '12' },
      ]);

      const result = await repository.countOrdersByRoutingCountrySince(
        new Date('2026-07-31T10:00:00.000Z')
      );

      expect(ormRepository.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(result).toEqual([
        { country: 'PL', orderCount: 47 },
        { country: 'DE', orderCount: 12 },
      ]);
    });

    it('should group on the DELIVERY address country the rule engine routes on', async () => {
      const parts = stubQueryBuilder([]);

      await repository.countOrdersByRoutingCountrySince(new Date());

      // Must stay the same field `toSalesDocumentOrderFacts` reads, or
      // discovery would name markets the evaluator never sees (ADR-066).
      expect(parts.groupBy).toHaveBeenCalledWith(
        expect.stringContaining(`'{shippingAddress,country}'`)
      );
      expect(parts.select).toHaveBeenCalledWith(
        expect.stringContaining(`'{shippingAddress,country}'`),
        'country'
      );
    });

    it('should exclude a row with no country rather than grouping it under an empty key', async () => {
      const parts = stubQueryBuilder([]);

      await repository.countOrdersByRoutingCountrySince(new Date());

      // NULLIF(btrim(...), '') collapses blank into NULL, and the NOT NULL arm
      // then drops both: the evaluator cannot route such an order either.
      expect(parts.select).toHaveBeenCalledWith(
        expect.stringContaining("NULLIF(btrim("),
        'country'
      );
      expect(parts.andWhere).toHaveBeenCalledWith(expect.stringContaining('IS NOT NULL'));
    });

    it('should bound the window on the same COALESCE the coverage read uses', async () => {
      const parts = stubQueryBuilder([]);
      const since = new Date('2026-07-31T10:00:00.000Z');

      await repository.countOrdersByRoutingCountrySince(since);

      expect(parts.where).toHaveBeenCalledWith(
        expect.stringContaining('COALESCE(rec."placedAt", rec."createdAt")'),
        { since }
      );
    });

    it('should order by count descending with a deterministic country tiebreak', async () => {
      const parts = stubQueryBuilder([]);

      await repository.countOrdersByRoutingCountrySince(new Date());

      expect(parts.orderBy).toHaveBeenCalledWith('COUNT(*)', 'DESC');
      expect(parts.addOrderBy).toHaveBeenCalledWith(expect.any(String), 'ASC');
    });

    it('should coerce the driver-level string count to a number', async () => {
      stubQueryBuilder([{ country: 'PL', order_count: '47' }]);

      const [market] = await repository.countOrdersByRoutingCountrySince(new Date());

      expect(market.orderCount).toBe(47);
      expect(typeof market.orderCount).toBe('number');
    });
  });
});
