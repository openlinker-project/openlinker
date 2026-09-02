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
import { getMetadataArgsStorage } from 'typeorm';
import { IsNull, LessThan, MoreThanOrEqual } from 'typeorm';
import { OrderRecordRepository } from '../order-record.repository';
import type { OrderSyncStatusJson } from '../../entities/order-record.orm-entity';
import { OrderRecordOrmEntity } from '../../entities/order-record.orm-entity';
import { OrderRecord } from '../../../../domain/entities/order-record.entity';
import { AuthorityAttentionCountedReasonValues } from '@openlinker/core/fulfillment-authority';
import type { OrderSyncStatus, SyncAttempt } from '../../../../domain/types/order-sync.types';
import { OrderRecordNotFoundException } from '../../../../domain/exceptions/order-record-not-found.exception';

describe('OrderRecordRepository', () => {
  let repository: OrderRecordRepository;
  let ormRepository: jest.Mocked<Repository<OrderRecordOrmEntity>>;
  let transactionalManager: {
    save: jest.Mock<Promise<unknown>, unknown[]>;
    delete: jest.Mock;
    query: jest.Mock<Promise<unknown>, unknown[]>;
  };

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
      // #2282: the order-record half of `upsertWithLineItems` is the shared
      // frozen-attribution raw statement, not `save()`.
      query: jest.fn(),
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

  /**
   * Since #2282 `upsert()` is a raw `INSERT ... ON CONFLICT DO UPDATE` with
   * `RETURNING *`, not a `save()`. The write set is still defined by `toOrm`,
   * but a column is now excluded by never being NAMED in the statement - so
   * that is what these tests assert, instead of an unset entity property.
   */
  function mockUpsertReturning(entity: OrderRecordOrmEntity): void {
    (ormRepository.query as jest.Mock).mockResolvedValue([entity]);
  }

  function upsertCall(): [string, unknown[]] {
    const calls = (ormRepository.query as jest.Mock).mock.calls as unknown[][];
    return calls[0] as [string, unknown[]];
  }

  function upsertSql(): string {
    return upsertCall()[0];
  }

  function upsertParams(): unknown[] {
    return upsertCall()[1];
  }

  function expectColumnAbsentFromUpsert(column: string): void {
    expect(upsertSql()).not.toContain(`"${column}"`);
  }
  describe('updateOmsAttention (#2352)', () => {
    function attentionSql(): string {
      const calls = (ormRepository.query as jest.Mock).mock.calls as unknown[][];
      return calls[0][0] as string;
    }

    function attentionParams(): unknown[] {
      const calls = (ormRepository.query as jest.Mock).mock.calls as unknown[][];
      return calls[0][1] as unknown[];
    }

    it('should not touch the database at all when the producer is indeterminate', async () => {
      // Clearing on a transient failure would erase a true reason and replace it
      // with silence, which is worse than a stale one (#2100).
      await repository.updateOmsAttention('order-123', 'reservations', {
        kind: 'indeterminate',
      });

      expect(ormRepository.query as jest.Mock).not.toHaveBeenCalled();
    });

    it('should send the reason and its optional fields when the producer reports blocked', async () => {
      (ormRepository.query as jest.Mock).mockResolvedValue([]);

      await repository.updateOmsAttention('order-123', 'routing', {
        kind: 'blocked',
        reason: 'line-unfulfillable',
        detail: '2 line(s)',
        subjectRef: 'line-7',
      });

      const [, producer, proposed] = attentionParams();
      expect(producer).toBe('routing');
      expect(JSON.parse(proposed as string)).toEqual({
        producer: 'routing',
        reason: 'line-unfulfillable',
        detail: '2 line(s)',
        subjectRef: 'line-7',
      });
    });

    it('should omit an absent detail rather than sending an explicit null', async () => {
      (ormRepository.query as jest.Mock).mockResolvedValue([]);

      await repository.updateOmsAttention('order-123', 'routing', {
        kind: 'blocked',
        reason: 'line-unfulfillable',
      });

      expect(JSON.parse(attentionParams()[2] as string)).toEqual({
        producer: 'routing',
        reason: 'line-unfulfillable',
      });
    });

    it('should send a null payload when the producer reports none', async () => {
      (ormRepository.query as jest.Mock).mockResolvedValue([]);

      await repository.updateOmsAttention('order-123', 'reservations', { kind: 'none' });

      expect(attentionParams()[2]).toBeNull();
    });

    it('should scope both the removal and the replacement to the calling producer only', async () => {
      // The property that makes three producers safe on one column: everything
      // that is not mine survives, and only mine is rebuilt.
      (ormRepository.query as jest.Mock).mockResolvedValue([]);

      await repository.updateOmsAttention('order-123', 'reservations', { kind: 'none' });

      const sql = attentionSql();
      expect(sql).toContain(`e->>'producer' IS DISTINCT FROM $2`);
      expect(sql).toContain(`e->>'producer' = $2`);
    });

    it('should carry an existing since forward rather than restamping it', async () => {
      // An operator watching "how long has this been stuck" must not see the
      // clock reset because a reason was refined inside one episode.
      (ormRepository.query as jest.Mock).mockResolvedValue([]);

      await repository.updateOmsAttention('order-123', 'reservations', {
        kind: 'blocked',
        reason: 'reservation-shortfall',
      });

      expect(attentionSql()).toContain(`COALESCE(parts.mine->>'since', $4::text)`);
    });

    it('should guard the write so an unchanged state touches no row', async () => {
      (ormRepository.query as jest.Mock).mockResolvedValue([]);

      await repository.updateOmsAttention('order-123', 'reservations', { kind: 'none' });

      expect(attentionSql()).toContain(
        `rec."omsAttention" IS DISTINCT FROM NULLIF(next.value, '[]'::jsonb)`
      );
    });

    it('should normalise an emptied column back to NULL so nothing-reported has one spelling', async () => {
      (ormRepository.query as jest.Mock).mockResolvedValue([]);

      await repository.updateOmsAttention('order-123', 'reservations', { kind: 'none' });

      expect(attentionSql()).toContain(`SET "omsAttention" = NULLIF(next.value, '[]'::jsonb)`);
    });
  });

  describe('updateFulfillmentBlock (#2396)', () => {
    function blockSql(): string {
      const calls = (ormRepository.query as jest.Mock).mock.calls as unknown[][];
      return calls[0][0] as string;
    }

    function blockParams(): unknown[] {
      const calls = (ormRepository.query as jest.Mock).mock.calls as unknown[][];
      return calls[0][1] as unknown[];
    }

    it('should write the reason and its detail together', async () => {
      (ormRepository.query as jest.Mock).mockResolvedValue([]);

      await repository.updateFulfillmentBlock('order-123', {
        reason: 'routing-in-doubt',
        detail: 'decision dec-1 left live for resumption (timeout)',
      });

      expect(blockParams()).toEqual([
        'routing-in-doubt',
        'decision dec-1 left live for resumption (timeout)',
        'order-123',
      ]);
    });

    it('should send an explicit null pair when the block clears', async () => {
      // Level-triggered: `null` is the ONLY thing that clears a reason once the
      // condition resolves. A writer that skipped the clear would be sticky,
      // which is the #2100 lesson.
      (ormRepository.query as jest.Mock).mockResolvedValue([]);

      await repository.updateFulfillmentBlock('order-123', null);

      expect(blockParams()).toEqual([null, null, 'order-123']);
    });

    it('should guard the write so an unchanged value touches no row', async () => {
      // This is the overwhelmingly common path — every ingestion on every
      // install today writes `null` over `null`, and `updatedAt` is a live
      // filter axis (`FulfillmentStatusSyncService` scans `updatedSince`), so
      // an unguarded write would bump every order on every poll.
      (ormRepository.query as jest.Mock).mockResolvedValue([]);

      await repository.updateFulfillmentBlock('order-123', null);

      const sql = blockSql();
      expect(sql).toContain('"fulfillmentBlockReason" IS DISTINCT FROM $1');
      expect(sql).toContain('"fulfillmentBlockDetail" IS DISTINCT FROM $2');
    });
  });

  describe('countOrdersWithOmsAttention (#2352)', () => {
    function countSql(): string {
      const calls = (ormRepository.query as jest.Mock).mock.calls as unknown[][];
      return String(calls[0][0]);
    }

    it('should count only the reasons this build recognises as counted', async () => {
      (ormRepository.query as jest.Mock).mockResolvedValue([{ count: 3 }]);

      await expect(repository.countOrdersWithOmsAttention()).resolves.toBe(3);

      const sql = countSql();
      for (const reason of AuthorityAttentionCountedReasonValues) {
        expect(sql).toContain(`@ == "${reason}"`);
      }
    });

    it('should never match a reason value this build does not know', async () => {
      // A value written by a newer release and rolled back must not become a red
      // number with no badge anywhere to explain it (spec §4.4 S2-5).
      (ormRepository.query as jest.Mock).mockResolvedValue([{ count: 0 }]);

      await repository.countOrdersWithOmsAttention();

      expect(countSql()).not.toContain('automation-failed');
    });

    it('should coalesce a NULL column before testing it, so the negation stays total', async () => {
      // The `IS_SALES_DOCUMENT_BLOCKED` trap: `jsonb_path_exists(NULL, ...)` is
      // NULL, so `NOT (...)` is NULL and WHERE drops the row - an "everything is
      // fine" filter would return zero orders on a healthy install.
      (ormRepository.query as jest.Mock).mockResolvedValue([{ count: 0 }]);

      await repository.countOrdersWithOmsAttention();

      expect(countSql()).toContain(`COALESCE(rec."omsAttention", '[]'::jsonb)`);
    });

    it('should report zero when the driver hands back no rows', async () => {
      (ormRepository.query as jest.Mock).mockResolvedValue([]);

      await expect(repository.countOrdersWithOmsAttention()).resolves.toBe(0);
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

  /**
   * The reset guarantee, asserted STRUCTURALLY (Wave-1c review, finding 1).
   *
   * `fromRawRow` derives its reset set from the statement's write set, so this
   * test needs no maintenance when a column is added — it enumerates the ORM
   * entity's own columns and requires every one the statement did not write to
   * come back empty. A hand-kept reset list is exactly what let six columns
   * merged forward from main escape the guarantee the docblock states, twice.
   *
   * The `RETURNING *` row is stuffed with a non-empty sentinel for EVERY
   * column, so a column that escapes the reset is caught by its value, not by
   * an incidental `undefined`.
   */
  describe('upsert / fromRawRow: the derived out-of-band reset (#2282)', () => {
    /** Columns the analytics-free `upsert` statement writes, per `toOrm`. */
    const UPSERT_WRITE_SET = [
      'internalOrderId',
      'customerId',
      'sourceConnectionId',
      'sourceEventId',
      'orderSnapshot',
      'recordStatus',
      'mappingFailureReason',
      'dispatchByAt',
      'createdAt',
      'updatedAt',
    ];

    /** Non-null empty defaults, mirroring the repository's own map. */
    const EMPTY_DEFAULTS: Record<string, unknown> = {
      syncStatus: [],
      syncAttempts: [],
    };

    function allColumnProperties(): string[] {
      return getMetadataArgsStorage()
        .filterColumns(OrderRecordOrmEntity)
        .map((column) => column.propertyName);
    }

    it('resets EVERY column the upsert statement did not write', () => {
      const columns = allColumnProperties();
      // Sanity: the entity really is discoverable this way, and has grown well
      // past the write set — otherwise the loop below could pass vacuously.
      expect(columns.length).toBeGreaterThan(UPSERT_WRITE_SET.length);

      // The REAL statement builder's write set, and the REAL projection — not a
      // re-implementation of either, or the test would pass a repository that
      // had stopped resetting anything.
      const built = (
        repository as unknown as {
          buildFrozenAttributionUpsert: (
            entity: OrderRecordOrmEntity,
            includeAnalyticsColumns: boolean
          ) => { writeSet: ReadonlySet<string> };
        }
      ).buildFrozenAttributionUpsert(createOrmEntity(), false);
      expect([...built.writeSet].sort()).toEqual([...UPSERT_WRITE_SET].sort());

      // `RETURNING *` carrying a non-empty sentinel for every out-of-band
      // column, so an escapee is caught by its VALUE, not by an incidental
      // `undefined`.
      const row: Record<string, unknown> = { ...createOrmEntity() };
      for (const column of columns) {
        if (!built.writeSet.has(column)) {
          row[column] = 'LEAKED';
        }
      }

      const projected = (
        repository as unknown as {
          fromRawRow: (
            row: Record<string, unknown>,
            writeSet: ReadonlySet<string>
          ) => OrderRecordOrmEntity;
        }
      ).fromRawRow(row, built.writeSet) as unknown as Record<string, unknown>;

      for (const column of columns) {
        if (built.writeSet.has(column)) {
          continue;
        }
        expect({ column, value: projected[column] }).toEqual({
          column,
          value: EMPTY_DEFAULTS[column] ?? null,
        });
      }
    });

    it('assumes no column renames its database name, and says so', () => {
      // The statement quotes the PROPERTY name and `fromRawRow` matches the
      // write set on it, so the two agree only while property === column. A
      // `@Column({ name: 'foo_bar' })` would emit invalid SQL and silently
      // drop the column from the write set; fail here rather than there.
      const renamed = getMetadataArgsStorage()
        .filterColumns(OrderRecordOrmEntity)
        .filter((column) => typeof column.options.name === 'string')
        .map((column) => column.propertyName);

      expect(renamed).toEqual([]);
    });

    it('names every column it resets in the statement OR resets it, never neither', async () => {
      const columns = allColumnProperties();
      mockUpsertReturning(createOrmEntity());
      await repository.upsert(createDomainEntity());
      const sql = upsertSql();

      for (const column of columns) {
        const named = sql.includes(`"${column}"`);
        const inWriteSet = UPSERT_WRITE_SET.includes(column);
        // The write set the test asserts against must stay the statement's own.
        expect(named).toBe(inWriteSet);
      }
    });
  });

  describe('upsert', () => {
    it('should create new order record', async () => {
      const domainEntity = createDomainEntity();
      const savedEntity = createOrmEntity();
      mockUpsertReturning(savedEntity);

      const result = await repository.upsert(domainEntity);

      expect(result).toBeDefined();
      expect(result.internalOrderId).toBe('order-123');
      expect(ormRepository.query).toHaveBeenCalledTimes(1);
    });

    it('should update existing order record', async () => {
      const domainEntity = createDomainEntity();
      const existingEntity = createOrmEntity();
      existingEntity.updatedAt = new Date('2025-01-02T10:00:00Z');
      mockUpsertReturning(existingEntity);

      const result = await repository.upsert(domainEntity);

      expect(result).toBeDefined();
      expect(ormRepository.query).toHaveBeenCalledTimes(1);
    });

    it('should NOT write syncStatus even when the domain record carries one (#2140)', async () => {
      // Guards against a future caller reintroducing the clobber by passing
      // destination sync state through the ingestion path. updateSyncStatus is
      // the sole writer; a statement that carries this column resets the
      // per-destination rows it committed.
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
      mockUpsertReturning(savedEntity);

      await repository.upsert(domainEntity);

      expectColumnAbsentFromUpsert('syncStatus');
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
      mockUpsertReturning(savedEntity);

      await repository.upsert(domainEntity);

      // `recordStatus` IS in the write set - the 6th bound parameter.
      expect(upsertParams()[5]).toBe('awaiting_mapping');
    });

    it('should report cancelledAt as null even though RETURNING carries it (#2282)', async () => {
      // The pre-#2282 mock handed back whatever `save()` was given, so this
      // read-back could not happen in production either - the docblock has
      // always promised the excluded columns read empty. `RETURNING *` now
      // really does carry the row's value, so `fromRawRow` has to reset it or
      // both `OrderRecordService` call sites silently change behaviour.
      const savedEntity = createOrmEntity();
      savedEntity.cancelledAt = new Date('2026-08-01T12:00:00Z');
      mockUpsertReturning(savedEntity);

      const result = await repository.upsert(createDomainEntity());

      expect(result.cancelledAt).toBeNull();
    });

    it('should NOT include cancelledAt in the upsert statement (#1984)', async () => {
      // upsert() has no per-order lock around it, so writing cancelledAt here
      // would race with the atomic, COALESCE-based markCancelled() a concurrent
      // cancel-event call may commit at the same time. Never naming the column
      // in the statement is what keeps markCancelled its sole writer.
      const domainEntity = createDomainEntity();
      mockUpsertReturning(createOrmEntity());

      await repository.upsert(domainEntity);

      expectColumnAbsentFromUpsert('cancelledAt');
    });

    it('should NOT include fulfillmentState in the upsert statement (#2101)', async () => {
      // The ingestion path never carries a fulfillment rollup, so writing the
      // column here reset a `'dispatched'` order to NULL on every re-poll.
      // Absent from the statement - updateFulfillmentState is the sole writer.
      mockUpsertReturning(createOrmEntity());

      await repository.upsert(createDomainEntity());

      expectColumnAbsentFromUpsert('fulfillmentState');
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
      mockUpsertReturning(createOrmEntity());

      await repository.upsert(domainEntity);

      expectColumnAbsentFromUpsert('fulfillmentState');
    });

    it('should report every excluded column empty even though RETURNING carries them (#2282)', async () => {
      // The load-bearing half of the save() -> raw-SQL swap: the return
      // contract stays byte-identical, so callers still re-read via findById.
      const savedEntity = createOrmEntity();
      savedEntity.fulfillmentState = 'dispatched';
      savedEntity.syncStatus = [
        { destinationConnectionId: 'dest-connection-789', status: 'synced' },
      ];
      savedEntity.syncAttempts = [
        {
          destinationConnectionId: 'dest-connection-789',
          status: 'synced',
          attemptedAt: '2026-08-01T12:00:00Z',
        },
      ];
      savedEntity.cancelledAt = new Date('2026-08-01T12:00:00Z');
      savedEntity.salesDocumentBlockReason = 'trigger-model-manual';
      savedEntity.salesDocumentUnresolvedReason = 'no-configuration-for-country';
      savedEntity.salesDocumentBlockDetail = 'seeded';
      savedEntity.reportingCurrency = 'EUR';
      savedEntity.reportingTotalAmount = 425;
      savedEntity.exchangeRateId = 'e1f0c0de-0000-4000-8000-000000000001';
      savedEntity.fxRule = 'prev-business-day';
      savedEntity.fxStampedAt = new Date('2026-08-14T09:00:00Z');
      savedEntity.fxIntendedCurrency = 'EUR';
      mockUpsertReturning(savedEntity);

      const result = await repository.upsert(createDomainEntity());

      expect(result.syncStatus).toEqual([]);
      expect(result.syncAttempts).toEqual([]);
      expect(result.fulfillmentState).toBeNull();
      expect(result.cancelledAt).toBeNull();
      expect(result.salesDocumentBlockReason).toBeNull();
      expect(result.salesDocumentUnresolvedReason).toBeNull();
      expect(result.salesDocumentBlockDetail).toBeNull();
      expect(result.reportingCurrency).toBeNull();
      expect(result.reportingTotalAmount).toBeNull();
      expect(result.exchangeRateId).toBeNull();
      expect(result.fxRule).toBeNull();
      expect(result.fxStampedAt).toBeNull();
      expect(result.fxIntendedCurrency).toBeNull();
      // The ingestion-owned columns still come back.
      expect(result.internalOrderId).toBe('order-123');
      expect(result.recordStatus).toBe('ready');
    });

    it('should report omsAttention empty even though RETURNING carries it (#2352)', async () => {
      // The sharpest case of the exclusion: the column is an ARRAY shared by
      // three producers whose writer edits ONE entry, so round-tripping it here
      // would drop every producer's entry on every ingestion and re-add none.
      const savedEntity = createOrmEntity();
      savedEntity.omsAttention = [
        {
          producer: 'reservations',
          reason: 'reservation-shortfall',
          since: '2026-08-26T00:00:00.000Z',
        },
      ];
      mockUpsertReturning(savedEntity);

      const result = await repository.upsert(createDomainEntity());

      expect(result.omsAttention).toEqual([]);
    });

    it('should NOT include syncStatus or syncAttempts in the upsert statement (#2140)', async () => {
      // The ingestion path never carries destination sync state, so writing
      // these columns wiped the per-destination rows and the whole attempt
      // history on every re-poll. Naming neither column in either half of the
      // statement keeps updateSyncStatus the sole writer, and Postgres fills an
      // omitted column on INSERT from its `DEFAULT '[]'`.
      mockUpsertReturning(createOrmEntity());

      await repository.upsert(createDomainEntity());

      expectColumnAbsentFromUpsert('syncStatus');
      expectColumnAbsentFromUpsert('syncAttempts');
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
      mockUpsertReturning(createOrmEntity());

      await repository.upsert(domainEntity);

      expectColumnAbsentFromUpsert('syncAttempts');
    });

    it('should report both columns empty when the returned row omits them', async () => {
      // toDomain must read an absent property as "not part of this statement"
      // rather than throwing on `undefined.map`.
      const unsetEntity = createOrmEntity();
      delete (unsetEntity as Partial<OrderRecordOrmEntity>).syncStatus;
      delete (unsetEntity as Partial<OrderRecordOrmEntity>).syncAttempts;
      mockUpsertReturning(unsetEntity);

      const result = await repository.upsert(createDomainEntity());

      expect(result.syncStatus).toEqual([]);
      expect(result.syncAttempts).toEqual([]);
    });

    it('should keep sourceConnectionId and createdAt out of the DO UPDATE set (#2282)', async () => {
      mockUpsertReturning(createOrmEntity());

      await repository.upsert(createDomainEntity());

      const doUpdate = upsertSql().slice(upsertSql().indexOf('DO UPDATE'));
      // Matched at the start of a SET line, so the CASE's comparison against
      // EXCLUDED."sourceConnectionId" is not mistaken for an assignment.
      expect(doUpdate).not.toMatch(/^\s*"sourceConnectionId" =/m);
      expect(doUpdate).not.toMatch(/^\s*"createdAt" =/m);
      // save() auto-bumped @UpdateDateColumn; the raw statement must not lose that.
      expect(doUpdate).toContain('"updatedAt" = EXCLUDED."updatedAt"');
      // Same-source may advance, cross-source frozen.
      expect(doUpdate).toContain('"sourceEventId" = CASE');
    });

    it('should bind every value as a parameter and serialize the jsonb snapshot (#2282)', async () => {
      mockUpsertReturning(createOrmEntity());

      await repository.upsert(createDomainEntity());

      // No interpolation: the connection id reaches Postgres as a bound param.
      expect(upsertSql()).not.toContain('source-connection-123');
      expect(upsertParams()).toHaveLength(10);
      expect(upsertParams()[2]).toBe('source-connection-123');
      expect(typeof upsertParams()[4]).toBe('string');
      expect(JSON.parse(upsertParams()[4] as string)).toEqual({
        id: 'order-123',
        orderNumber: 'ORD-001',
        status: 'pending',
      });
    });
  });

  describe('upsertWithLineItems (#1985)', () => {
    it('saves the order record and inserts the derived line items in one transaction', async () => {
      const domainEntity = createDomainEntity();
      const savedEntity = createOrmEntity();
      transactionalManager.query.mockResolvedValue([savedEntity]);
      transactionalManager.save.mockResolvedValue([]);
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
      // The order record goes through the shared frozen-attribution statement
      // (#2282) and the line-item batch through save() — both on the SAME
      // manager, so they still commit or roll back together.
      expect(transactionalManager.query).toHaveBeenCalledTimes(1);
      expect(transactionalManager.save).toHaveBeenCalledTimes(1);
      expect(transactionalManager.delete).toHaveBeenCalledWith(expect.anything(), {
        orderRecordId: 'order-123',
      });
    });

    it('deletes the prior line-item set even when the new set is empty (order re-ingested with no items)', async () => {
      const domainEntity = createDomainEntity();
      const savedEntity = createOrmEntity();
      transactionalManager.query.mockResolvedValue([savedEntity]);
      transactionalManager.delete.mockResolvedValue(undefined);

      await repository.upsertWithLineItems(domainEntity, []);

      expect(transactionalManager.delete).toHaveBeenCalledWith(expect.anything(), {
        orderRecordId: 'order-123',
      });
      // Only the order-record statement runs — no line-item save for an empty set.
      expect(transactionalManager.query).toHaveBeenCalledTimes(1);
      expect(transactionalManager.save).not.toHaveBeenCalled();
    });

    it('propagates a failure from either write so the caller sees the transaction as failed', async () => {
      const domainEntity = createDomainEntity();
      transactionalManager.query.mockRejectedValue(new Error('db error'));

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
      transactionalManager.query.mockResolvedValue([createOrmEntity()]);
      transactionalManager.delete.mockResolvedValue(undefined);

      await repository.upsertWithLineItems(domainEntity, []);

      const [sql, params] = transactionalManager.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('"placedAt"');
      expect(sql).toContain('"currency"');
      expect(sql).toContain('"taxTreatment"');
      expect(sql).toContain('"totalAmount"');
      expect(params).toEqual(
        expect.arrayContaining([new Date('2025-01-01T09:00:00Z'), 'PLN', 'inclusive', 199.99])
      );
    });

    // #2282 / ADR-057: the freeze must hold on THIS write path too. The
    // integration spec proves the behaviour against real Postgres; this
    // asserts the emitted statement's shape so a future edit that reverts to a
    // full-object `save()` fails here as well as there.
    it('emits the shared frozen-attribution statement: sourceConnectionId insert-only, sourceEventId conditional', async () => {
      const domainEntity = createDomainEntity();
      transactionalManager.query.mockResolvedValue([createOrmEntity()]);
      transactionalManager.delete.mockResolvedValue(undefined);

      await repository.upsertWithLineItems(domainEntity, []);

      const [sql] = transactionalManager.query.mock.calls[0] as [string];
      const updateSet = sql.slice(sql.indexOf('DO UPDATE SET'));
      // No assignment line for either column (the `"sourceConnectionId" = ...`
      // substring DOES appear inside the CASE comparison below, so match on a
      // line-initial assignment rather than on the bare substring).
      expect(updateSet).not.toMatch(/^\s*"sourceConnectionId" =/m);
      expect(updateSet).not.toMatch(/^\s*"createdAt" =/m);
      expect(updateSet).toContain(
        '"order_records"."sourceConnectionId" = EXCLUDED."sourceConnectionId"'
      );
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
      'round-trips buyerTaxId in the %s state through the upsert and toDomain() (#2599 review, finding 4)',
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
          null,
          null,
          null,
          null,
          null,
          [],
          stored
        );
        const savedOrm = createOrmEntity();
        savedOrm.buyerTaxId = stored;
        // The write is the hand-built frozen-attribution upsert, not `save()`:
        // that statement ENUMERATES its columns, so a column stamped on the
        // entity but never added to it is silently not written. Asserting on
        // the parameters is what pins `buyerTaxId` into the statement.
        transactionalManager.query.mockResolvedValue([savedOrm]);
        transactionalManager.delete.mockResolvedValue(undefined);

        await repository.upsertWithLineItems(domainEntity, []);

        const [sql, params] = transactionalManager.query.mock.calls[0] as [string, unknown[]];
        expect(sql).toContain('"buyerTaxId"');
        expect(params).toContain(stored);

        ormRepository.findOne.mockResolvedValue(savedOrm);
        const read = await repository.findById('order-123');
        expect(read?.buyerTaxId).toBe(expected);
      }
    );

    it('pins shippingAddressHash into the ready-path statement and reads it back (#2395)', async () => {
      // Same argument as `buyerTaxId` above: the frozen-attribution upsert
      // ENUMERATES its columns, so a value stamped on the entity but never
      // added to the statement is silently not written.
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
        null,
        null,
        null,
        null,
        null,
        [],
        null,
        'abc123hash'
      );
      const savedOrm = createOrmEntity();
      savedOrm.shippingAddressHash = 'abc123hash';
      transactionalManager.query.mockResolvedValue([savedOrm]);
      transactionalManager.delete.mockResolvedValue(undefined);

      await repository.upsertWithLineItems(domainEntity, []);

      const [sql, params] = transactionalManager.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain('"shippingAddressHash"');
      expect(params).toContain('abc123hash');

      ormRepository.findOne.mockResolvedValue(savedOrm);
      expect((await repository.findById('order-123'))?.shippingAddressHash).toBe('abc123hash');
    });

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

    it('should never emit an empty jsonpath filter for the omsAttention predicate (#2352)', async () => {
      // HAS_OMS_ATTENTION is built from AuthorityAttentionCountedReasonValues at
      // class-definition time. An empty array interpolates to `$[*].reason ? ()`,
      // which Postgres rejects at PARSE time — taking down the orders list, the
      // summary aggregate and `countOrdersWithOmsAttention` together. The sibling
      // guard above exists for exactly this class of defect one predicate over.
      const andWhere = jest.fn().mockReturnThis();
      (ormRepository.createQueryBuilder as jest.Mock).mockReturnValue({
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        andWhere,
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      });

      await repository.findMany({ omsAttention: true }, { limit: 20, offset: 0 });

      const predicate = andWhere.mock.calls
        .map((c: unknown[]) => c[0] as string)
        .find((c) => c.includes('omsAttention'));
      expect(predicate).toBeDefined();
      expect(predicate).not.toContain('? ()');
      expect(predicate).toContain('@ ==');
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
      it('should NOT include omsAttention in the upsert statement (#2352)', async () => {
        mockUpsertReturning(createOrmEntity());

        await repository.upsert(createDomainEntity());

        expectColumnAbsentFromUpsert('omsAttention');
      });

      it('should NOT include either fulfillmentBlock column in the upsert statement (#2396)', async () => {
        // The explicit #2396 acceptance criterion. `persistOrder` runs BEFORE
        // the fulfilment intercept on every ingestion, so if either column were
        // in the write set a re-poll would null the reason the previous
        // transition wrote — and then re-add none, because the intercept has
        // not run yet. The order would read "nothing is wrong" while being
        // held. `updateFulfillmentBlock` is the sole writer.
        mockUpsertReturning(createOrmEntity());

        await repository.upsert(createDomainEntity());

        expectColumnAbsentFromUpsert('fulfillmentBlockReason');
        expectColumnAbsentFromUpsert('fulfillmentBlockDetail');
      });

      it('should NOT include any of the six FX columns in the upsert statement', async () => {
        // upsert() is an update-or-create on the ingestion path, so naming
        // these columns would let a re-poll of an already-stamped order write
        // `null` over a reported financial figure. They appear in neither half
        // of the statement — claimFxIntentIfAbsent / stampFxIfAbsent are their
        // only writers.
        mockUpsertReturning(createOrmEntity());

        await repository.upsert(createDomainEntity());

        expectColumnAbsentFromUpsert('reportingCurrency');
        expectColumnAbsentFromUpsert('reportingTotalAmount');
        expectColumnAbsentFromUpsert('exchangeRateId');
        expectColumnAbsentFromUpsert('fxRule');
        expectColumnAbsentFromUpsert('fxStampedAt');
        expectColumnAbsentFromUpsert('fxIntendedCurrency');
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
        mockUpsertReturning(createOrmEntity());

        await repository.upsert(stamped);

        expectColumnAbsentFromUpsert('reportingCurrency');
        expectColumnAbsentFromUpsert('reportingTotalAmount');
        expectColumnAbsentFromUpsert('exchangeRateId');
        expectColumnAbsentFromUpsert('fxRule');
        expectColumnAbsentFromUpsert('fxStampedAt');
        expectColumnAbsentFromUpsert('fxIntendedCurrency');
      });

      it('should NOT name the four analytics scalars (#1985 review, finding 1) in the upsert() statement', async () => {
        // upsert() is reached by persistIncomingSnapshot, whose OrderRecord
        // never carries a resolved analytics figure. Mapping these columns
        // here would NULL out an already-`ready` order's figures on every
        // re-poll (transient), and leave them permanently NULL once item
        // resolution starts failing (permanent) — upsertWithLineItems() is
        // their sole writer instead. Since #2282 upsert() is a raw
        // `INSERT ... ON CONFLICT DO UPDATE`, so exclusion is asserted as the
        // column never being NAMED, not as an unset entity property.
        mockUpsertReturning(createOrmEntity());

        await repository.upsert(createDomainEntity());

        expectColumnAbsentFromUpsert('placedAt');
        expectColumnAbsentFromUpsert('currency');
        expectColumnAbsentFromUpsert('taxTreatment');
        expectColumnAbsentFromUpsert('totalAmount');
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
        mockUpsertReturning(createOrmEntity());

        await repository.upsert(withScalars);

        expectColumnAbsentFromUpsert('placedAt');
        expectColumnAbsentFromUpsert('currency');
        expectColumnAbsentFromUpsert('taxTreatment');
        expectColumnAbsentFromUpsert('totalAmount');
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
