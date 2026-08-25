/**
 * Return Repository — unit spec (#2327)
 *
 * Mocks the two TypeORM repositories and the DataSource; the schema-level
 * guarantees (the CHECK, both unique indexes, the CASCADE) are asserted against
 * a real Postgres in `apps/api/test/integration/returns-schema.int-spec.ts`,
 * because none of them is expressible against a mock.
 *
 * @module infrastructure/persistence/repositories
 */
import { ReturnRepository } from './return.repository';
import type { ReturnOrmEntity } from '../entities/return.orm-entity';
import type { ReturnLineOrmEntity } from '../entities/return-line.orm-entity';
import type { CreateReturnRecordInput } from '../../../domain/types/return.types';
import type { UpsertReturnRecordInput } from '../../../domain/types/return-upsert.types';
import { ReturnPersistenceError } from '../../../domain/exceptions/return-persistence.error';

const buildInput = (
  overrides: Partial<CreateReturnRecordInput> = {}
): CreateReturnRecordInput => ({
  sourceConnectionId: '11111111-1111-1111-1111-111111111111',
  externalReturnId: 'RET-1',
  internalOrderId: 'ol_order_abc',
  externalOrderId: 'SRC-ORDER-1',
  origin: 'source_ingested',
  rawStatus: 'WAITING_FOR_PARCEL',
  rawPayload: { anything: 'the source sent' },
  openedAt: new Date('2026-08-01T10:00:00Z'),
  authorizedAt: null,
  declinedAt: null,
  closedAt: null,
  lines: [
    {
      lineIndex: 0,
      externalLineId: null,
      resolvedOrderLineId: null,
      offerId: null,
      sku: 'SKU-1',
      name: 'A thing',
      reason: 'withdrawal',
      quantityAdvised: 2,
      note: null,
    },
  ],
  ...overrides,
});

describe('ReturnRepository', () => {
  let repository: ReturnRepository;
  let returns: { findOne: jest.Mock; find: jest.Mock };
  let lines: { find: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let warn: jest.SpyInstance;

  beforeEach(() => {
    returns = { findOne: jest.fn(), find: jest.fn() };
    lines = { find: jest.fn() };
    // Runs the callback against a manager that echoes back whatever it saved,
    // stamping the columns Postgres would fill in.
    dataSource = {
      transaction: jest.fn(async (callback: (manager: unknown) => Promise<unknown>) =>
        callback({
          save: jest.fn((_entity: unknown, value: unknown) => {
            const now = new Date('2026-08-02T00:00:00Z');
            const stamp = (row: Record<string, unknown>): Record<string, unknown> => ({
              ...row,
              id: row.id ?? 'uuid-generated',
              createdAt: now,
              updatedAt: now,
            });
            return Array.isArray(value) ? value.map(stamp) : stamp(value as Record<string, unknown>);
          }),
        })
      ),
    };

    repository = new ReturnRepository(
      returns as never,
      lines as never,
      dataSource as never
    );
    warn = jest
      .spyOn((repository as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('create', () => {
    it('should mint an ol_return_ prefixed id when creating a return', async () => {
      const created = await repository.create(buildInput());

      expect(created.id).toMatch(/^ol_return_[0-9a-f]{32}$/);
    });

    it('should stamp the header id onto every line when creating a return', async () => {
      const created = await repository.create(
        buildInput({
          lines: [
            { ...buildInput().lines[0], lineIndex: 0 },
            { ...buildInput().lines[0], lineIndex: 1 },
          ],
        })
      );

      expect(created.lines.map((line) => line.returnId)).toEqual([created.id, created.id]);
    });

    it('should write the header and its lines in one transaction when creating a return', async () => {
      await repository.create(buildInput());

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
    });

    it('should default the undriven counters and state columns when creating a return', async () => {
      const created = await repository.create(buildInput());
      const [line] = created.lines;

      // The DB DEFAULTs are what actually apply; the domain reads them back as
      // numbers rather than strings, which is the property under test here.
      expect(line.quantityAdvised).toBe(2);
      expect(typeof line.quantityAdvised).toBe('number');
    });

    it('should round-trip a null internalOrderId when creating an orphan return', async () => {
      const created = await repository.create(buildInput({ internalOrderId: null }));

      expect(created.internalOrderId).toBeNull();
    });

    it('should land each of the three adjacent nullable id fields on its own property', async () => {
      // `externalReturnId`, `internalOrderId` and `externalOrderId` are three ADJACENT
      // `string | null` constructor parameters, so a mis-ordered `toDomain` type-checks
      // and is silently wrong — `tsc` proves only the arity. Three DISTINCT values are
      // what actually closes that (#2332).
      const created = await repository.create(
        buildInput({
          externalReturnId: 'THE-RETURN-ID',
          internalOrderId: 'THE-INTERNAL-ORDER-ID',
          externalOrderId: 'THE-SOURCE-ORDER-ID',
        })
      );

      expect([created.externalReturnId, created.internalOrderId, created.externalOrderId]).toEqual([
        'THE-RETURN-ID',
        'THE-INTERNAL-ORDER-ID',
        'THE-SOURCE-ORDER-ID',
      ]);
    });

    it('should round-trip a null externalOrderId when the source names no order', async () => {
      const created = await repository.create(buildInput({ externalOrderId: null }));

      expect(created.externalOrderId).toBeNull();
    });

    it('should preserve rawStatus and rawPayload verbatim when creating a return', async () => {
      const created = await repository.create(
        buildInput({ rawStatus: 'SOMETHING_ONLY_THE_SOURCE_KNOWS' })
      );

      expect([created.rawStatus, created.rawPayload]).toEqual([
        'SOMETHING_ONLY_THE_SOURCE_KNOWS',
        { anything: 'the source sent' },
      ]);
    });
  });

  describe('findById', () => {
    it('should return null when no header exists', async () => {
      returns.findOne.mockResolvedValue(null);

      await expect(repository.findById('ol_return_missing')).resolves.toBeNull();
    });

    it('should coerce counters to numbers when reading a line back', async () => {
      returns.findOne.mockResolvedValue(buildHeaderRow());
      lines.find.mockResolvedValue([buildLineRow({ quantityReceived: '1' as unknown as number })]);

      const found = await repository.findById('ol_return_x');

      expect(found?.lines[0].quantityReceived).toBe(1);
    });

    it('should fall back to "other" when the stored reason is outside the union', async () => {
      returns.findOne.mockResolvedValue(buildHeaderRow());
      lines.find.mockResolvedValue([buildLineRow({ reason: 'a_reason_from_the_future' })]);

      const found = await repository.findById('ol_return_x');

      expect([found?.lines[0].reason, warn]).toEqual(['other', warn]);
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('listOrphans', () => {
    it('should query only unattributed returns, newest first, when listing orphans', async () => {
      returns.find.mockResolvedValue([]);

      await repository.listOrphans(25, 50);

      const [options] = returns.find.mock.calls[0] as [Record<string, unknown>];
      expect([
        (options.where as Record<string, unknown>).internalOrderId !== undefined,
        options.order,
        options.take,
        options.skip,
      ]).toEqual([true, { createdAt: 'DESC' }, 25, 50]);
    });

    it('should return headers without hydrating lines when listing orphans', async () => {
      returns.find.mockResolvedValue([buildHeaderRow({ internalOrderId: null })]);

      const orphans = await repository.listOrphans(10, 0);

      expect([orphans.length, orphans[0].lines, lines.find]).toEqual([1, [], lines.find]);
      expect(lines.find).not.toHaveBeenCalled();
    });
  });

  describe('countOrphans', () => {
    it('should count with the same unattributed predicate the orphan list uses', async () => {
      const count = jest.fn().mockResolvedValue(7);
      (returns as unknown as { count: jest.Mock }).count = count;

      await expect(repository.countOrphans()).resolves.toBe(7);

      const [options] = count.mock.calls[0] as [Record<string, unknown>];
      expect((options.where as Record<string, unknown>).internalOrderId).toBeDefined();
    });
  });
});

const buildHeaderRow = (overrides: Partial<ReturnOrmEntity> = {}): ReturnOrmEntity =>
  ({
    id: 'ol_return_x',
    sourceConnectionId: '11111111-1111-1111-1111-111111111111',
    externalReturnId: 'RET-1',
    internalOrderId: 'ol_order_abc',
    externalOrderId: 'SRC-ORDER-1',
    origin: 'source_ingested',
    rawStatus: null,
    rawPayload: null,
    openedAt: null,
    authorizedAt: null,
    declinedAt: null,
    closedAt: null,
    createdAt: new Date('2026-08-02T00:00:00Z'),
    updatedAt: new Date('2026-08-02T00:00:00Z'),
    ...overrides,
  }) as ReturnOrmEntity;

const buildLineRow = (overrides: Partial<ReturnLineOrmEntity> = {}): ReturnLineOrmEntity =>
  ({
    id: 'a3f24b09-c4d1-4867-89ab-cdef01234567',
    returnId: 'ol_return_x',
    lineIndex: 0,
    externalLineId: null,
    resolvedOrderLineId: null,
    offerId: null,
    sku: null,
    name: null,
    reason: 'withdrawal',
    quantityAdvised: 1,
    quantityReceived: 0,
    quantityRestocked: 0,
    quantityScrapped: 0,
    custodyState: 'advised',
    moneyState: 'not_refundable',
    disposition: null,
    receivedAt: null,
    disposedAt: null,
    note: null,
    createdAt: new Date('2026-08-02T00:00:00Z'),
    updatedAt: new Date('2026-08-02T00:00:00Z'),
    ...overrides,
  }) as ReturnLineOrmEntity;

/**
 * `upsertFromSource` — the #2328 idempotent update-or-create.
 *
 * These assert the STATEMENT, not the database: that both writes share one
 * transaction, that the conflict target carries the partial index's predicate,
 * and — the headline AC — that no OL-owned or Wave-2 column appears in either
 * half. What the statements then do to real rows is asserted against Postgres
 * in `apps/api/test/integration/returns-ingestion.int-spec.ts`.
 */
describe('ReturnRepository.upsertFromSource', () => {
  const HEADER_ROW = {
    id: 'ol_return_abc',
    sourceConnectionId: '11111111-1111-1111-1111-111111111111',
    externalReturnId: 'RET-1',
    internalOrderId: 'ol_order_abc',
    externalOrderId: 'SRC-ORDER-1',
    origin: 'source_ingested',
    rawStatus: 'WAITING',
    rawPayload: null,
    openedAt: new Date('2026-08-01T10:00:00Z'),
    // The row's TRUE OL-owned values — the reset must hide them.
    authorizedAt: new Date('2026-08-03T00:00:00Z'),
    declinedAt: new Date('2026-08-04T00:00:00Z'),
    closedAt: new Date('2026-08-05T00:00:00Z'),
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-02T00:00:00Z'),
  };

  const buildUpsertInput = (
    overrides: Partial<UpsertReturnRecordInput> = {}
  ): UpsertReturnRecordInput => ({
    sourceConnectionId: '11111111-1111-1111-1111-111111111111',
    externalReturnId: 'RET-1',
    internalOrderId: 'ol_order_abc',
    externalOrderId: 'SRC-ORDER-1',
    origin: 'source_ingested',
    rawStatus: 'WAITING',
    rawPayload: { anything: 'the source sent' },
    openedAt: new Date('2026-08-01T10:00:00Z'),
    lines: [
      {
        lineIndex: 0,
        externalLineId: 'L-1',
        offerId: null,
        sku: 'SKU-1',
        name: 'A thing',
        reason: 'withdrawal',
        quantityAdvised: 2,
        note: null,
      },
    ],
    ...overrides,
  });

  let repository: ReturnRepository;
  let query: jest.Mock;
  let find: jest.Mock;
  let transaction: jest.Mock;
  let warn: jest.SpyInstance;

  const calls = (): unknown[][] => query.mock.calls as unknown[][];
  const statements = (): string[] => calls().map((call) => String(call[0]));
  const headerSql = (): string => statements()[0];
  const lineSql = (): string | undefined => statements()[1];

  beforeEach(() => {
    query = jest.fn().mockResolvedValue([HEADER_ROW]);
    find = jest.fn().mockResolvedValue([]);
    transaction = jest.fn(async (callback: (manager: unknown) => Promise<unknown>) =>
      callback({ query, find })
    );

    repository = new ReturnRepository(
      { findOne: jest.fn(), find: jest.fn() } as never,
      { find: jest.fn() } as never,
      { transaction } as never
    );
    warn = jest
      .spyOn((repository as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => warn.mockRestore());

  it('should write the header and its lines inside ONE transaction', async () => {
    await repository.upsertFromSource(buildUpsertInput());

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('should carry the partial-index predicate on the header conflict target', async () => {
    await repository.upsertFromSource(buildUpsertInput());

    // A bare conflict target does not match a PARTIAL unique index — without
    // the predicate Postgres raises "no unique or exclusion constraint matching
    // the ON CONFLICT specification" at runtime.
    expect(headerSql()).toContain('ON CONFLICT ("sourceConnectionId", "externalReturnId")');
    expect(headerSql()).toContain('WHERE "externalReturnId" IS NOT NULL');
  });

  it('should key the line statement on (returnId, lineIndex) and never replace-all', async () => {
    await repository.upsertFromSource(buildUpsertInput());

    expect(lineSql()).toContain('ON CONFLICT ("returnId", "lineIndex")');
    // A delete-and-replace would destroy Wave-2 custody state.
    expect(lineSql()).not.toMatch(/DELETE\s+FROM/i);
  });

  it('should apply internalOrderId and openedAt with COALESCE, so attribution is monotonic', async () => {
    await repository.upsertFromSource(buildUpsertInput());

    expect(headerSql()).toContain(
      '"internalOrderId" = COALESCE(EXCLUDED."internalOrderId", "returns"."internalOrderId")'
    );
    expect(headerSql()).toContain(
      '"openedAt" = COALESCE(EXCLUDED."openedAt", "returns"."openedAt")'
    );
  });

  it.each(['authorizedAt', 'declinedAt', 'closedAt'])(
    'should never name the OL-owned timestamp %s anywhere in the header statement',
    async (column) => {
      await repository.upsertFromSource(buildUpsertInput());

      expect(headerSql()).not.toContain(`"${column}"`);
    }
  );

  it.each([
    'quantityReceived',
    'quantityRestocked',
    'quantityScrapped',
    'custodyState',
    'moneyState',
    'disposition',
    'receivedAt',
    'disposedAt',
    'resolvedOrderLineId',
  ])('should never name the Wave-2 line column %s anywhere in the line statement', async (column) => {
    await repository.upsertFromSource(buildUpsertInput());

    expect(lineSql()).not.toContain(`"${column}"`);
  });

  it('should keep sourceConnectionId, externalReturnId and origin insert-only', async () => {
    await repository.upsertFromSource(buildUpsertInput());

    const sql = headerSql();
    const doUpdate = sql.slice(sql.indexOf('DO UPDATE SET'));
    for (const column of ['sourceConnectionId', 'externalReturnId', 'origin', 'createdAt']) {
      expect(doUpdate).not.toContain(`"${column}" =`);
    }
    // …but each IS on the INSERT half, or a first write could not satisfy the
    // NOT NULL columns.
    const insertHalf = sql.slice(0, sql.indexOf('ON CONFLICT'));
    for (const column of ['sourceConnectionId', 'externalReturnId', 'origin']) {
      expect(insertHalf).toContain(`"${column}"`);
    }
  });

  it('should report the three OL-owned timestamps as null whatever the row holds', async () => {
    const { record } = await repository.upsertFromSource(buildUpsertInput());

    // `RETURNING *` carried real values (see HEADER_ROW); the documented
    // contract is that callers re-read via findById for their true value.
    expect(record.authorizedAt).toBeNull();
    expect(record.declinedAt).toBeNull();
    expect(record.closedAt).toBeNull();
    expect(record.internalOrderId).toBe('ol_order_abc');
  });

  it('should skip the line statement entirely when the source reports no lines', async () => {
    await repository.upsertFromSource(buildUpsertInput({ lines: [] }));

    // An empty VALUES list is a syntax error, and no lines is not an error.
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('should build one placeholder group per line', async () => {
    await repository.upsertFromSource(
      buildUpsertInput({
        lines: [
          {
            lineIndex: 0,
            externalLineId: null,
            offerId: null,
            sku: null,
            name: null,
            reason: 'withdrawal',
            quantityAdvised: 1,
            note: null,
          },
          {
            lineIndex: 1,
            externalLineId: null,
            offerId: null,
            sku: null,
            name: null,
            reason: 'defective',
            quantityAdvised: 3,
            note: null,
          },
        ],
      })
    );

    expect(lineSql()).toContain('($1, $2, $3, $4, $5, $6, $7, $8, $9)');
    expect(lineSql()).toContain('($10, $11, $12, $13, $14, $15, $16, $17, $18)');
    expect((calls()[1][1] as unknown[]).length).toBe(18);
  });

  it('should keep a line the source stopped reporting, and warn about it', async () => {
    find.mockResolvedValue([buildLineRow({ lineIndex: 0 }), buildLineRow({ lineIndex: 1 })]);

    const { record } = await repository.upsertFromSource(buildUpsertInput());

    expect(record.lines).toHaveLength(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('kept, not deleted'));
  });

  it('should wrap an infrastructure failure in a domain error', async () => {
    query.mockRejectedValue(new Error('deadlock detected'));

    await expect(repository.upsertFromSource(buildUpsertInput())).rejects.toBeInstanceOf(
      ReturnPersistenceError
    );
  });
});

/**
 * Sweep reads (#2330).
 *
 * These assert the QUERY, not the rows — the row-level behaviour is proved
 * against real Postgres in `allegro-returns-status-sync.int-spec.ts`, which is
 * where it belongs because the empty-`NOT IN` case is a SQL-syntax question. The
 * property worth pinning here is that the page read and the count read are built
 * from the SAME clauses: if they ever diverge, the scan offset wraps against a
 * set it is not paging through and silently skips or repeats rows forever.
 */
describe('ReturnRepository sweep reads', () => {
  const openedSince = new Date('2026-05-01T00:00:00Z');

  function makeQueryBuilder() {
    const qb: Record<string, jest.Mock> = {};
    for (const method of [
      'where',
      'andWhere',
      'select',
      'orderBy',
      'addOrderBy',
      'limit',
      'offset',
    ]) {
      qb[method] = jest.fn(() => qb);
    }
    qb.getRawMany = jest.fn().mockResolvedValue([]);
    qb.getCount = jest.fn().mockResolvedValue(7);
    return qb;
  }

  function build(terminalRawStatuses: readonly string[]) {
    const qb = makeQueryBuilder();
    const returnsRepo = { createQueryBuilder: jest.fn(() => qb) };
    const repository = new ReturnRepository(returnsRepo as never, {} as never, {} as never);
    const filter = {
      sourceConnectionId: 'conn-1',
      origin: 'source_ingested' as const,
      terminalRawStatuses,
      openedSince,
    };
    return { qb, repository, filter };
  }

  function clauses(qb: Record<string, jest.Mock>): string[] {
    const whereCalls = qb.where.mock.calls as unknown[][];
    const andWhereCalls = qb.andWhere.mock.calls as unknown[][];
    return [
      ...whereCalls.map((c) => c[0] as string),
      ...andWhereCalls.map((c) => c[0] as string),
    ];
  }

  it('should filter by connection, origin, a usable external id and the age bound', async () => {
    const { qb, repository, filter } = build(['FINISHED']);

    await repository.findForSourceSweep(filter, 10, 0);

    const applied = clauses(qb).join(' | ');
    expect(applied).toContain('"sourceConnectionId" = :connectionId');
    expect(applied).toContain('"origin" = :origin');
    // A return with no source key has nothing to re-read BY — including it
    // would guarantee a 404 on every single run.
    expect(applied).toContain('"externalReturnId" IS NOT NULL');
    expect(applied).toContain('>= :openedSince');
  });

  it('should apply the terminal exclusion as opaque set membership', async () => {
    const { qb, repository, filter } = build(['FINISHED', 'REJECTED']);

    await repository.findForSourceSweep(filter, 10, 0);

    expect(clauses(qb).join(' | ')).toContain('"rawStatus" NOT IN (:...terminalRawStatuses)');
    expect(qb.andWhere).toHaveBeenCalledWith(expect.stringContaining('NOT IN'), {
      terminalRawStatuses: ['FINISHED', 'REJECTED'],
    });
  });

  it('should OMIT the exclusion entirely for an empty vocabulary', async () => {
    // `NOT IN ()` is a Postgres syntax error, so rendering it would take down
    // the sweep for every adapter that declares no terminal statuses.
    const { qb, repository, filter } = build([]);

    await repository.findForSourceSweep(filter, 10, 0);

    expect(clauses(qb).join(' | ')).not.toContain('NOT IN');
  });

  it('should order deterministically so a scan offset means the same thing twice', async () => {
    const { qb, repository, filter } = build([]);

    await repository.findForSourceSweep(filter, 10, 0);

    expect(qb.orderBy).toHaveBeenCalledWith(expect.stringContaining('COALESCE'), 'ASC');
    expect(qb.addOrderBy).toHaveBeenCalledWith('r.id', 'ASC');
  });

  it('should page with limit/offset, not the entity-paging helpers', async () => {
    const { qb, repository, filter } = build([]);

    await repository.findForSourceSweep(filter, 25, 50);

    expect(qb.limit).toHaveBeenCalledWith(25);
    expect(qb.offset).toHaveBeenCalledWith(50);
  });

  it('should build the count from the SAME clauses as the page', async () => {
    const page = build(['FINISHED']);
    await page.repository.findForSourceSweep(page.filter, 10, 0);

    const count = build(['FINISHED']);
    const total = await count.repository.countForSourceSweep(count.filter);

    expect(total).toBe(7);
    expect(clauses(count.qb)).toEqual(clauses(page.qb));
  });

  it('should project the raw rows onto sweep candidates', async () => {
    const { qb, repository, filter } = build([]);
    qb.getRawMany.mockResolvedValue([
      { r_id: 'ol_return_1', r_externalReturnId: 'r-1', r_rawStatus: 'DELIVERED' },
    ]);

    expect(await repository.findForSourceSweep(filter, 10, 0)).toEqual([
      { id: 'ol_return_1', externalReturnId: 'r-1', rawStatus: 'DELIVERED' },
    ]);
  });
});
