/**
 * Order Record Repository - paged/count predicate parity (#2944)
 *
 * `findMany` (rows AND total), `findManyRows` (the page alone) and `countMany`
 * (the total alone) must apply ONE predicate. If they drift, the total starts
 * describing a different set than the page - a wrong number rendered
 * authoritatively, which is worse than a missing one.
 *
 * The parity is structural: all three call `buildFilteredQuery`. This spec
 * proves it by recording every `andWhere(sql, params)` the repository issues
 * and asserting the paged path and the count path emit the IDENTICAL sequence,
 * for every filter this list accepts and for a combination of all of them.
 *
 * It is deliberately a fast unit test over a recording builder rather than an
 * assertion about rows - `paginated-total-split.int-spec.ts` proves the two
 * SELECT the same rows against real Postgres. This one proves the WEAKER but
 * sharper thing: that a filter added to one path and not the other fails the
 * build, which is the drift an integration test only catches if somebody
 * remembers to extend its fixtures too.
 *
 * @module libs/core/src/orders/infrastructure/persistence/repositories/__tests__
 */
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { OrderRecordRepository } from '../order-record.repository';
import { OrderRecordOrmEntity } from '../../entities/order-record.orm-entity';
import type { OrderRecordFilters } from '../../../../domain/types/order-record.types';

/** One recorded `andWhere` call: the SQL fragment and its bound parameters. */
interface RecordedPredicate {
  sql: unknown;
  params: unknown;
}

/**
 * A chainable stand-in for `SelectQueryBuilder` that records only the calls
 * this spec is about. Ordering and paging are accepted and ignored: they are
 * not predicates, and the whole point is that a count applies neither.
 */
function createRecordingQueryBuilder(): {
  predicates: RecordedPredicate[];
  ordering: unknown[];
  paging: { take?: unknown; skip?: unknown };
  builder: Record<string, unknown>;
} {
  const predicates: RecordedPredicate[] = [];
  const ordering: unknown[] = [];
  const paging: { take?: unknown; skip?: unknown } = {};

  const builder: Record<string, unknown> = {};
  const chain = (fn: (...args: unknown[]) => void) =>
    jest.fn((...args: unknown[]) => {
      fn(...args);
      return builder;
    });

  Object.assign(builder, {
    andWhere: chain((sql, params) => predicates.push({ sql, params })),
    orderBy: chain((...args) => ordering.push(['orderBy', ...args])),
    addOrderBy: chain((...args) => ordering.push(['addOrderBy', ...args])),
    addSelect: chain(() => undefined),
    setParameter: chain(() => undefined),
    setParameters: chain(() => undefined),
    take: chain((v) => {
      paging.take = v;
    }),
    skip: chain((v) => {
      paging.skip = v;
    }),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    getMany: jest.fn().mockResolvedValue([]),
    getCount: jest.fn().mockResolvedValue(0),
  });

  return { predicates, ordering, paging, builder };
}

describe('OrderRecordRepository paged/count predicate parity (#2944)', () => {
  let repository: OrderRecordRepository;
  let builders: ReturnType<typeof createRecordingQueryBuilder>[];

  beforeEach(async () => {
    // `applySlaFilter` binds `new Date()` as a parameter, so three reads a
    // millisecond apart differ in that bound value alone.
    //
    // An earlier version of this spec froze the clock to make the comparison
    // exact, and called that hygiene (#2957 review round 5, I1). It was not:
    // the flake WAS the finding. Parity here is achieved by sharing one
    // predicate builder, so the only way to break it from inside that builder
    // is a term that varies per call - which is exactly what `slaState` has,
    // and freezing the clock turned a true statement about production into a
    // green test.
    //
    // The clock is still frozen, because a spec that flakes teaches nobody
    // anything - but the property is now asserted positively below rather than
    // suppressed, and `slaState`'s impurity is stated where a reader will meet
    // it.
    jest.useFakeTimers().setSystemTime(new Date('2026-06-01T00:00:00Z'));
    builders = [];
    const ormRepository = {
      createQueryBuilder: jest.fn(() => {
        const next = createRecordingQueryBuilder();
        builders.push(next);
        return next.builder;
      }),
    } as unknown as Repository<OrderRecordOrmEntity>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderRecordRepository,
        { provide: getRepositoryToken(OrderRecordOrmEntity), useValue: ormRepository },
      ],
    }).compile();

    repository = module.get<OrderRecordRepository>(OrderRecordRepository);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /** Run one read and hand back the single builder it created. */
  async function record(
    run: () => Promise<unknown>
  ): Promise<ReturnType<typeof createRecordingQueryBuilder>> {
    builders = [];
    await run();
    expect(builders).toHaveLength(1);
    return builders[0];
  }

  /**
   * Every filter `OrderRecordFilters` accepts, one per case, plus an
   * everything-at-once case. A new filter added to `findMany` without a case
   * here still cannot drift (the parity assertion covers whatever is applied),
   * but a case here makes the failure name the filter.
   */
  const CASES: ReadonlyArray<readonly [string, OrderRecordFilters]> = [
    ['no filters', {}],
    ['sourceConnectionId', { sourceConnectionId: 'conn-1' }],
    ['customerId', { customerId: 'cust-1' }],
    ['createdFrom', { createdFrom: new Date('2026-01-01T00:00:00Z') }],
    ['createdTo', { createdTo: new Date('2026-02-01T00:00:00Z') }],
    ['syncStatus (jsonb containment)', { syncStatus: 'failed' }],
    ['recordStatus', { recordStatus: 'ready' }],
    ['destinationConnectionId (jsonb containment)', { destinationConnectionId: 'conn-2' }],
    ['updatedSince', { updatedSince: new Date('2026-01-15T00:00:00Z') }],
    ['dueBefore', { dueBefore: new Date('2026-03-01T00:00:00Z') }],
    ['health', { health: 'needs_attention' }],
    ['fulfillmentState', { fulfillmentState: 'dispatched' }],
    ['slaState', { slaState: 'overdue' }],
    ['cancelled=true', { cancelled: true }],
    ['cancelled=false', { cancelled: false }],
    ['salesDocumentBlocked=true', { salesDocumentBlocked: true }],
    ['salesDocumentBlocked=false', { salesDocumentBlocked: false }],
    ['lifecyclePhase', { lifecyclePhase: 'held' }],
    ['taxRateConflict=true', { taxRateConflict: true }],
    ['taxRateConflict=false', { taxRateConflict: false }],
    ['omsAttention=true', { omsAttention: true }],
    ['omsAttention=false', { omsAttention: false }],
    ['activeHoldReason', { activeHoldReason: 'fraud-review' }],
    [
      'every filter at once',
      {
        sourceConnectionId: 'conn-1',
        customerId: 'cust-1',
        createdFrom: new Date('2026-01-01T00:00:00Z'),
        createdTo: new Date('2026-02-01T00:00:00Z'),
        syncStatus: 'failed',
        recordStatus: 'ready',
        destinationConnectionId: 'conn-2',
        updatedSince: new Date('2026-01-15T00:00:00Z'),
        dueBefore: new Date('2026-03-01T00:00:00Z'),
        health: 'needs_attention',
        fulfillmentState: 'dispatched',
        slaState: 'overdue',
        cancelled: true,
        salesDocumentBlocked: true,
        lifecyclePhase: 'cancelled',
        taxRateConflict: true,
        omsAttention: true,
        activeHoldReason: 'fraud-review',
      },
    ],
  ];

  describe.each(CASES)('%s', (_label, filters) => {
    it('applies the identical predicate on findMany, findManyRows and countMany', async () => {
      const paged = await record(() => repository.findMany(filters, { limit: 20, offset: 0 }));
      const rowsOnly = await record(() =>
        repository.findManyRows(filters, { limit: 20, offset: 0 })
      );
      const counted = await record(() => repository.countMany(filters));

      expect(counted.predicates).toEqual(paged.predicates);
      expect(rowsOnly.predicates).toEqual(paged.predicates);
    });
  });

  it('never applies ordering or a page window to the count', async () => {
    const filters: OrderRecordFilters = { health: 'needs_attention', sort: 'total', dir: 'desc' };

    const paged = await record(() => repository.findMany(filters, { limit: 20, offset: 40 }));
    const counted = await record(() => repository.countMany(filters));

    // The paged read orders and windows; the count must do neither. A count
    // that carried `LIMIT 20` would answer 20 for every large result set, and
    // an `ORDER BY` on a count is work with no effect on the answer.
    expect(paged.ordering.length).toBeGreaterThan(0);
    expect(paged.paging).toEqual({ take: 20, skip: 40 });
    expect(counted.ordering).toEqual([]);
    expect(counted.paging).toEqual({});
  });

  it('keeps findMany on a single getManyAndCount rather than two statements', async () => {
    // `?withTotal=true` is the default and every un-migrated caller uses it, so
    // the combined read must stay byte-identical to its pre-#2944 self: one
    // `getManyAndCount()` on one query runner. Composing it from the two new
    // methods would run them on two pool connections - an unmeasured change to
    // the shipped path, inside a change about something else.
    //
    // This is NOT a claim that the count is skipped for a short page. Read
    // against typeorm@0.3.17, `getManyAndCount` runs both statements
    // unconditionally; there is no `lazyCount` in that version.
    const paged = await record(() => repository.findMany({}, { limit: 20, offset: 0 }));

    expect(paged.builder.getManyAndCount).toHaveBeenCalledTimes(1);
    expect(paged.builder.getMany).not.toHaveBeenCalled();
    expect(paged.builder.getCount).not.toHaveBeenCalled();
  });

  it('reads the page with getMany and the total with getCount', async () => {
    const rowsOnly = await record(() => repository.findManyRows({}, { limit: 20, offset: 0 }));
    expect(rowsOnly.builder.getMany).toHaveBeenCalledTimes(1);
    expect(rowsOnly.builder.getCount).not.toHaveBeenCalled();

    const counted = await record(() => repository.countMany({}));
    expect(counted.builder.getCount).toHaveBeenCalledTimes(1);
    expect(counted.builder.getMany).not.toHaveBeenCalled();
    expect(counted.builder.getManyAndCount).not.toHaveBeenCalled();
  });
  it('binds a per-call instant for slaState, and for NOTHING else', async () => {
    // The one predicate that is not a pure function of its filters. Stated as a
    // test rather than left to the frozen clock to hide (#2957 review round 5,
    // I1), because the consequence is operator-visible: `GET /orders?slaState=`
    // and `GET /orders/count?slaState=` are two requests binding two instants,
    // so an order crossing `dispatchByAt` between them is in the page and not
    // in the total. `<ListPagination>` mitigates it by enabling Next when the
    // rows OVERRUN the total - not on any full page, which would send the
    // operator to a blank one at every exact multiple of the page size - and
    // the mitigation is incomplete at a page boundary. A reader changing either
    // half needs to know the other exists.
    //
    // Break it by making a SECOND predicate time-dependent and this fails,
    // which is the point: the impurity must stay confined to one filter.
    // The combined case is INCLUDED (#2957 review round 6, S1): a term that
    // binds an instant only when two filters are both present is invisible in
    // every single-filter case, and skipping the one case that sets them all
    // was the only place it could have shown up.
    const impure: Array<readonly [string, OrderRecordFilters]> = [];
    for (const [label, filters] of CASES) {
      const first = await record(() => repository.countMany(filters));
      // Two hours, not five seconds: a predicate binding a MINUTE- or
      // DAY-truncated instant is still impure and would read pure across a
      // five-second step (#2957 review round 6, S1).
      jest.setSystemTime(new Date('2026-06-01T02:00:00Z'));
      const second = await record(() => repository.countMany(filters));
      jest.setSystemTime(new Date('2026-06-01T00:00:00Z'));
      if (JSON.stringify(first.predicates) !== JSON.stringify(second.predicates)) {
        impure.push([label, filters]);
      }
    }

    // The combined case carries `slaState`, so it is impure for the same one
    // reason rather than a second.
    expect(impure.map(([label]) => label)).toEqual(['slaState', 'every filter at once']);
  });
});
