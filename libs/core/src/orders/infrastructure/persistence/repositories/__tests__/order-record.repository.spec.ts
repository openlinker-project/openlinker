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

  beforeEach(async () => {
    const qb = {
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };

    const mockOrmRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      query: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(qb),
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
});
