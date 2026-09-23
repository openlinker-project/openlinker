/**
 * Bench work service (#2416, `W3b-3`, stories B1–B4, decision D8)
 *
 * The scoping tests are the load-bearing ones. D8 exists because a derived list
 * *"would show work routed to a 3PL"* — so the case that must never regress is
 * a work assigned to somebody else appearing on this bench.
 */
import type {
  FulfillmentWorkListFilter,
  FulfillmentWorkPageView,
  FulfillmentWorkView,
} from '@openlinker/core/fulfillment';
import type { Connection } from '@openlinker/core/identifier-mapping';
import type { IIntegrationsService } from '@openlinker/core/integrations';
import type { IOrderRecordService, OrderRecord } from '@openlinker/core/orders';
import { OMS_ADAPTER_KEY } from '@openlinker/oms';

import type { IConnectionService } from '../../../integrations/application/interfaces/connection.service.interface';
import { BenchExecutorResolver } from '../services/bench-executor.resolver';
import { BenchWorkService } from '../services/bench-work.service';
import { BENCH_ELIGIBILITY_FIXTURES } from './bench-eligibility.fixture';

const OMS_CONNECTION = {
  id: 'conn-oms',
  name: 'Warehouse packing',
  platformType: 'openlinker',
  // NULL, exactly as the connection create form leaves it — which is why the
  // service must resolve the adapter through the registry rather than compare
  // this field. A string compare here matches nothing on a real install.
  adapterKey: undefined,
  status: 'active',
  enabledCapabilities: ['FulfillmentExecutor'],
  config: {},
} as unknown as Connection;

function connection(over: Partial<Connection> = {}): Connection {
  return { ...OMS_CONNECTION, ...over } as Connection;
}

function workView(over: Partial<FulfillmentWorkView> = {}): FulfillmentWorkView {
  return {
    id: 'w-1',
    orderId: 'ol_order_1',
    locationId: 'loc-1',
    deliveryMethod: 'courier',
    assignedConnectionId: 'conn-oms',
    assignedToUserId: null,
    selfServeEligible: true,
    parcelClosedAt: null,
    status: 'open',
    requestStatus: 'accepted',
    assignmentAttempt: 1,
    cancellationReason: null,
    externalWorkId: null,
    acceptedAt: new Date('2026-09-04T08:00:00Z'),
    cancelledAt: null,
    expeditedAt: null,
    createdAt: new Date('2026-09-04T07:00:00Z'),
    updatedAt: new Date('2026-09-04T08:00:00Z'),
    lines: [
      { id: 'l-1', orderLineId: 'ol-1', productVariantId: 'v-1', totalQuantity: 4, fulfilledQuantity: 0, cancelledQuantity: 1 },
      { id: 'l-2', orderLineId: 'ol-2', productVariantId: 'v-2', totalQuantity: 3, fulfilledQuantity: 0, cancelledQuantity: 0 },
    ],
    activeHolds: [],
    supportedActions: ['expedite'],
    version: 5,
    packedByUserId: null,
    invoicePrintedAt: null,
    labelPrintedAt: null,
    completedAt: null,
    completedByUserId: null,
    ...over,
  } as FulfillmentWorkView;
}

function orderRecord(over: Partial<OrderRecord> = {}): OrderRecord {
  return {
    internalOrderId: 'ol_order_1',
    dispatchByAt: new Date('2026-09-04T16:00:00Z'),
    orderSnapshot: {
      orderNumber: 'OL-4471',
      shippingAddress: { firstName: 'Jan', lastName: 'Wiśniewski', address1: 'Secret 1' },
    },
    ...over,
  } as unknown as OrderRecord;
}

interface Harness {
  service: BenchWorkService;
  list: jest.Mock;
  siblings: jest.Mock;
  findByIds: jest.Mock;
  /**
   * The filter the service asked with.
   *
   * Captured through a TYPED closure rather than read off `mock.calls`, which
   * is `any` — and an `any` here would let a filter-shape assertion pass
   * against a field that no longer exists.
   */
  lastFilter: () => FulfillmentWorkListFilter;
  parcels: { claimParcel: jest.Mock };
}

function harness(options: {
  connections?: Connection[];
  page?: Partial<FulfillmentWorkPageView>;
  orders?: OrderRecord[];
  siblingIds?: Map<string, string[]>;
  adapterKey?: string;
} = {}): Harness {
  const page: FulfillmentWorkPageView = {
    works: [workView()],
    total: 1,
    limit: 100,
    offset: 0,
    ...options.page,
  };
  let captured: FulfillmentWorkListFilter | undefined;
  const list = jest.fn((filter: FulfillmentWorkListFilter) => {
    captured = filter;
    return Promise.resolve(page);
  });
  const siblings = jest.fn().mockResolvedValue(options.siblingIds ?? new Map());
  const findByIds = jest.fn().mockResolvedValue(options.orders ?? [orderRecord()]);

  const connections: IConnectionService = {
    list: jest.fn().mockResolvedValue(options.connections ?? [connection()]),
  } as unknown as IConnectionService;

  const integrations: IIntegrationsService = {
    resolveAdapterMetadata: jest
      .fn()
      .mockResolvedValue({ adapterKey: options.adapterKey ?? OMS_ADAPTER_KEY }),
  } as unknown as IIntegrationsService;

  const parcels = { claimParcel: jest.fn() };

  // The executor resolution moved out of this service in #2418, so that story
  // D2's refusal can apply the SAME rule. It is constructed here rather than
  // stubbed: the rules it carries (active, capability enabled, registry-resolved
  // adapter key) are what these cases exercise, and a stub would assert nothing
  // about them.
  const service = new BenchWorkService(
    new BenchExecutorResolver(connections, integrations),
    { list, get: jest.fn(), applyAction: jest.fn(), listSiblingWorkIds: siblings } as never,
    { findByIds } as unknown as IOrderRecordService,
    parcels as never,
    // The catalogue read the rail's item list needs. Stubbed empty: every test
    // in this harness is about scoping, sorting and eligibility, and a row with
    // no resolvable products still carries its counts.
    {
      getVariantsByIds: jest.fn().mockResolvedValue([]),
      getProductsByIds: jest.fn().mockResolvedValue([]),
    } as never
  );

  return {
    service,
    list,
    siblings,
    findByIds,
    lastFilter: () => {
      if (captured === undefined) throw new Error('listWorks was never called');
      return captured;
    },
    parcels,
  };
}

describe('BenchWorkService (#2416)', () => {
  describe('scoping (story B1, decision D8)', () => {
    it('should ask only for work assigned to the packing connection', async () => {
      const { service, list } = harness();

      await service.listBenchWork('viewer-1', true);

      expect(list).toHaveBeenCalledWith(expect.objectContaining({ assignedConnectionId: ['conn-oms'] }));
    });

    it('should ask only for ACCEPTED work', async () => {
      // A parcel the executor has not taken on is not this bench's work yet,
      // and one it rejected never will be.
      const { service, list } = harness();

      await service.listBenchWork('viewer-1', true);

      expect(list).toHaveBeenCalledWith(expect.objectContaining({ requestStatus: ['accepted'] }));
    });

    it('should exclude closed and incomplete work, and INCLUDE cancelled', async () => {
      const harnessed = harness();

      await harnessed.service.listBenchWork('viewer-1', true);

      const statuses = harnessed.lastFilter().status ?? [];
      expect(statuses).not.toContain('closed');
      expect(statuses).not.toContain('incomplete');
      // A cancelled parcel whose tote is on the bench must be told to STOP —
      // the mockup's "do not pack these" section. Hiding it means it gets packed.
      expect(statuses).toContain('cancelled');
    });

    it('should select the OLDEST work when the page is bounded', async () => {
      // The urgency sort happens above this read, so the direction decides which
      // rows survive truncation. Newest-first would drop the most overdue.
      const { service, list } = harness();

      await service.listBenchWork('viewer-1', true);

      expect(list).toHaveBeenCalledWith(expect.objectContaining({ orderBy: 'createdAt_ASC' }));
    });

    it('should resolve the packing connection through the REGISTRY, not its adapterKey column', async () => {
      // The fixture's `adapterKey` is undefined — what a real row holds. A
      // string compare would match nothing and the bench would report "nothing
      // is set up" for ever.
      const { service } = harness();

      const view = await service.listBenchWork('viewer-1', true);

      expect(view.routing.ready).toBe(true);
      expect(view.works).toHaveLength(1);
    });

    it('should ignore a connection whose adapter is not the packing one', async () => {
      const { service } = harness({ adapterKey: 'somebody.else.v1' });

      const view = await service.listBenchWork('viewer-1', true);

      expect(view.routing).toEqual({ ready: false, reason: 'no-packing-connection' });
      expect(view.works).toEqual([]);
    });

    it('should ignore a connection that is not active', async () => {
      const { service } = harness({ connections: [connection({ status: 'disabled' } as never)] });

      expect((await service.listBenchWork('viewer-1', true)).routing.ready).toBe(false);
    });

    it('should ignore a connection that has not enabled packing', async () => {
      const { service } = harness({
        connections: [connection({ enabledCapabilities: ['OrderSource'] } as never)],
      });

      expect((await service.listBenchWork('viewer-1', true)).routing.ready).toBe(false);
    });
  });

  describe('the two empty states (story B3)', () => {
    it('should report NOT READY as its own fact rather than as an empty list', async () => {
      const { service } = harness({ connections: [] });

      const view = await service.listBenchWork('viewer-1', true);

      expect(view.routing).toEqual({ ready: false, reason: 'no-packing-connection' });
      expect(view.executorName).toBeNull();
    });

    it('should report READY with an empty list when there is simply nothing to pack', async () => {
      const { service } = harness({ page: { works: [], total: 0 } });

      const view = await service.listBenchWork('viewer-1', true);

      // Same empty array, different fact — which is the whole of B3.
      expect(view.routing).toEqual({ ready: true });
      expect(view.works).toEqual([]);
    });
  });

  describe('the projection', () => {
    it('should count units to verify WITHOUT consulting fulfilled quantities (story B2)', async () => {
      const { service } = harness({
        page: {
          works: [
            workView({
              lines: [
                { id: 'l-1', orderLineId: 'a', productVariantId: 'v', totalQuantity: 4, fulfilledQuantity: 3, cancelledQuantity: 1 },
              ],
            }),
          ],
        },
      });

      const view = await service.listBenchWork('viewer-1', true);

      // 4 total − 1 cancelled = 3. The 3 already "fulfilled" is deliberately
      // not subtracted: OpenLinker cannot see a shelf, and a smaller number
      // here would be a readiness claim.
      expect(view.works[0].unitsToVerify).toBe(3);
    });

    it('should carry the order reference and buyer name, and NOTHING else from the snapshot', async () => {
      const { service } = harness();

      const [row] = (await service.listBenchWork('viewer-1', true)).works;

      expect(row.orderReference).toBe('OL-4471');
      expect(row.buyerName).toBe('Jan Wiśniewski');
      // The snapshot carries an address; the projection must not.
      expect(JSON.stringify(row)).not.toContain('Secret 1');
    });

    it('should fall back to the internal id when the source names no reference', async () => {
      const { service } = harness({ orders: [orderRecord({ orderSnapshot: {} } as never)] });

      expect((await service.listBenchWork('viewer-1', true)).works[0].orderReference).toBe('ol_order_1');
    });

    it('should report a MISSING buyer name as null rather than a placeholder', async () => {
      // Ordinary under `OL_STORE_PII=false`: the address is redacted, so there
      // is no name to report.
      const { service } = harness({
        orders: [orderRecord({ orderSnapshot: { orderNumber: 'OL-4471' } } as never)],
      });

      expect((await service.listBenchWork('viewer-1', true)).works[0].buyerName).toBeNull();
    });

    it('reports `mine` and `claimable: true` for a parcel assigned to the viewer', async () => {
      const { service } = harness({
        page: { works: [workView({ assignedToUserId: 'viewer-1', selfServeEligible: false })] },
      });

      const [row] = (await service.listBenchWork('viewer-1', true)).works;

      expect(row.assignmentState).toBe('mine');
      expect(row.claimable).toBe(true);
    });

    it('reports `unassigned` and `claimable: true` for a parcel nobody was named on', async () => {
      const { service } = harness({
        page: { works: [workView({ assignedToUserId: null, selfServeEligible: true })] },
      });

      const [row] = (await service.listBenchWork('viewer-1', true)).works;

      expect(row.assignmentState).toBe('unassigned');
      expect(row.claimable).toBe(true);
    });

    it('reports `assigned-other` and `claimable: false` for a locked parcel assigned elsewhere', async () => {
      const { service } = harness({
        page: {
          works: [workView({ assignedToUserId: 'someone-else', selfServeEligible: false })],
        },
      });

      const [row] = (await service.listBenchWork('viewer-1', true)).works;

      expect(row.assignmentState).toBe('assigned-other');
      expect(row.claimable).toBe(false);
    });

    it('reports `assigned-other` but `claimable: true` when self-serve is eligible', async () => {
      const { service } = harness({
        page: {
          works: [workView({ assignedToUserId: 'someone-else', selfServeEligible: true })],
        },
      });

      const [row] = (await service.listBenchWork('viewer-1', true)).works;

      expect(row.assignmentState).toBe('assigned-other');
      expect(row.claimable).toBe(true);
    });

    it('should derive HELD from the hold rows, not from the status', async () => {
      // Nothing writes `status = 'on_hold'` — a held work reads `open`.
      const { service } = harness({
        page: {
          works: [
            workView({
              status: 'open',
              activeHolds: [
                { id: 'h-1', reason: 'address-invalid', note: null, placedAt: new Date('2026-09-04T09:12:00Z') },
              ],
            }),
          ],
        },
      });

      const [row] = (await service.listBenchWork('viewer-1', true)).works;

      expect(row.state).toBe('held');
      expect(row.holdReason).toBe('address-invalid');
    });

    it('should mark a cancelled parcel cancelled', async () => {
      const { service } = harness({ page: { works: [workView({ status: 'cancelled' })] } });

      expect((await service.listBenchWork('viewer-1', true)).works[0].state).toBe('cancelled');
    });

    it('should count EVERY parcel of the order, not only the ones on this bench', async () => {
      // A sibling that is closed, held elsewhere or routed to another executor
      // is absent from this page — so counting the page would say "1 of 1"
      // about a split order, precisely where the number matters.
      const { service } = harness({
        siblingIds: new Map([['ol_order_1', ['w-0', 'w-1', 'w-2']]]),
      });

      const [row] = (await service.listBenchWork('viewer-1', true)).works;

      expect(row.parcelIndex).toBe(2);
      expect(row.parcelTotal).toBe(3);
    });

    it('should say "1 of 1" rather than "of 0" when siblings cannot be read', async () => {
      const { service } = harness({ siblingIds: new Map() });

      const [row] = (await service.listBenchWork('viewer-1', true)).works;

      expect(row.parcelIndex).toBe(1);
      expect(row.parcelTotal).toBe(1);
    });

    it('should order the rows most urgent first', async () => {
      const { service } = harness({
        page: {
          works: [
            workView({ id: 'late', orderId: 'o-late' }),
            workView({ id: 'soon', orderId: 'o-soon' }),
            workView({ id: 'pushed', orderId: 'o-pushed', expeditedAt: new Date('2026-09-04T09:00:00Z') }),
          ],
          total: 3,
        },
        orders: [
          orderRecord({ internalOrderId: 'o-late', dispatchByAt: new Date('2026-09-06T16:00:00Z') } as never),
          orderRecord({ internalOrderId: 'o-soon', dispatchByAt: new Date('2026-09-04T12:00:00Z') } as never),
          orderRecord({ internalOrderId: 'o-pushed', dispatchByAt: new Date('2026-09-09T16:00:00Z') } as never),
        ],
      });

      const view = await service.listBenchWork('viewer-1', true);

      expect(view.works.map((row) => row.workId)).toEqual(['pushed', 'soon', 'late']);
    });

    it('should batch the order and sibling reads once for the page, never per row', async () => {
      const { service, findByIds, siblings } = harness({
        page: {
          works: [workView({ id: 'a', orderId: 'o-1' }), workView({ id: 'b', orderId: 'o-2' })],
          total: 2,
        },
        orders: [
          orderRecord({ internalOrderId: 'o-1' } as never),
          orderRecord({ internalOrderId: 'o-2' } as never),
        ],
      });

      await service.listBenchWork('viewer-1', true);

      expect(findByIds).toHaveBeenCalledTimes(1);
      expect(siblings).toHaveBeenCalledTimes(1);
      expect(findByIds).toHaveBeenCalledWith(['o-1', 'o-2']);
    });

    it('should page until it has the whole set, and never render one parcel twice', async () => {
      // A FULL page is what continues the walk, so the fixture uses real page
      // sizes. Paging a LIVE table can hand the same row back twice when a
      // parcel leaves the filter mid-walk and shifts later rows into an offset
      // already read; two rows sharing an id render as a duplicated parcel — a
      // packer packing one box twice.
      const full = Array.from({ length: 100 }, (_, i) => workView({ id: `w-${String(i)}` }));
      const overlapping = [
        // `w-99` again — the duplicate a shifted offset produces.
        workView({ id: 'w-99' }),
        workView({ id: 'w-100' }),
      ];
      const list = jest
        .fn()
        .mockResolvedValueOnce({ works: full, total: 101, limit: 100, offset: 0 })
        .mockResolvedValue({ works: overlapping, total: 101, limit: 100, offset: 100 });

      const service = new BenchWorkService(
        new BenchExecutorResolver(
          { list: jest.fn().mockResolvedValue([connection()]) } as unknown as IConnectionService,
          {
            resolveAdapterMetadata: jest.fn().mockResolvedValue({ adapterKey: OMS_ADAPTER_KEY }),
          } as unknown as IIntegrationsService
        ),
        {
          list,
          get: jest.fn(),
          applyAction: jest.fn(),
          listSiblingWorkIds: jest.fn().mockResolvedValue(new Map()),
        } as never,
        { findByIds: jest.fn().mockResolvedValue([orderRecord()]) } as unknown as IOrderRecordService,
        { claimParcel: jest.fn() } as never,
        {
      getVariantsByIds: jest.fn().mockResolvedValue([]),
      getProductsByIds: jest.fn().mockResolvedValue([]),
    } as never
      );

      const view = await service.listBenchWork('viewer-1', true);

      const ids = view.works.map((row) => row.workId);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toHaveLength(101);
      expect(list).toHaveBeenCalledTimes(2);
    });

    it('should report the unpaged total so a truncated list can say so', async () => {
      const { service } = harness({ page: { works: [workView()], total: 900 } });

      expect((await service.listBenchWork('viewer-1', true)).total).toBe(900);
    });
  });

  describe('supervises (#3340, ADR-071)', () => {
    it('a packer omits assigned-other rows and `total` matches what they were given', async () => {
      const { service } = harness({
        page: {
          works: [
            workView({ id: 'w-mine', assignedToUserId: 'viewer-1' }),
            workView({ id: 'w-unassigned', assignedToUserId: null }),
            workView({ id: 'w-other', assignedToUserId: 'someone-else' }),
          ],
          total: 3,
        },
      });

      const view = await service.listBenchWork('viewer-1', false);

      expect(view.works.map((w) => w.workId)).toEqual(['w-mine', 'w-unassigned']);
      expect(view.works.every((w) => w.assignmentState !== 'assigned-other')).toBe(true);
      expect(view.total).toBe(2);
    });

    it('a supervisor keeps assigned-other rows and the unfiltered total', async () => {
      const { service } = harness({
        page: {
          works: [
            workView({ id: 'w-mine', assignedToUserId: 'viewer-1' }),
            workView({ id: 'w-unassigned', assignedToUserId: null }),
            workView({ id: 'w-other', assignedToUserId: 'someone-else' }),
          ],
          total: 3,
        },
      });

      const view = await service.listBenchWork('viewer-1', true);

      // Lexicographic tiebreak in `compareBenchWork` — every row here shares
      // the same (absent) urgency signal, so workId decides the order.
      expect(view.works.map((w) => w.workId)).toEqual(['w-mine', 'w-other', 'w-unassigned']);
      expect(view.total).toBe(3);
    });

    it('drops an assigned-other row even when self-serve makes it claimable', async () => {
      // The grouping is by ASSIGNMENT STATE, not by claimability — a
      // self-serve-eligible parcel locked to someone else still belongs in
      // "Assigned to other packers", and a packer must not see that section.
      const { service } = harness({
        page: {
          works: [workView({ assignedToUserId: 'someone-else', selfServeEligible: true })],
        },
      });

      const view = await service.listBenchWork('viewer-1', false);

      expect(view.works).toEqual([]);
      expect(view.total).toBe(0);
    });

    it('subtracts only the hidden count from an already-truncated total', async () => {
      const { service } = harness({
        page: {
          works: [
            workView({ id: 'w-mine', assignedToUserId: 'viewer-1' }),
            workView({ id: 'w-other', assignedToUserId: 'someone-else' }),
          ],
          total: 900,
        },
      });

      const view = await service.listBenchWork('viewer-1', false);

      expect(view.works.map((w) => w.workId)).toEqual(['w-mine']);
      expect(view.total).toBe(899);
    });
  });

  /**
   * Story G4 — *"the bench and the worklist never disagree"* (#2420, `W3b-7`).
   *
   * The list's half of the shared table. `bench-parcel.service.spec.ts` reads the
   * same rows and asserts the refusal, so the two surfaces are pinned against ONE
   * set of cases rather than against each other's current behaviour.
   *
   * `bench-work-eligibility.spec.ts` already proves the pure rule answers these
   * correctly. That is not what is at stake here: this asserts the SERVICE still
   * asks it, and still returns the answer it got. A service that called the
   * shared rule and then adjusted the result is invisible to a spec that only
   * exercises the function.
   */
  describe('story G4 — the list colours a row with the shared rule', () => {
    it.each(BENCH_ELIGIBILITY_FIXTURES)(
      '$name',
      async ({ status, requestStatus, activeHoldCount, expected }) => {
        const { service } = harness({
          page: {
            works: [
              workView({
                status,
                requestStatus,
                activeHolds: Array.from({ length: activeHoldCount }, (_unused, index) => ({
                  id: `hold-${String(index)}`,
                  reason: 'address-invalid' as const,
                  note: null,
                  placedAt: new Date('2026-09-04T09:00:00Z'),
                })),
              }),
            ],
            total: 1,
          },
        });

        const view = await service.listBenchWork('viewer-1', true);

        expect(view.works).toHaveLength(1);
        expect(view.works[0].state).toBe(expected);
      }
    );
  });

  /**
   * Story G4's other half: the desktop worklist (#2406) and the bench must mean
   * the same thing by an action and by a token.
   *
   * Both surfaces read the same `FulfillmentWorkView`. So the bench must pass
   * `supportedActions` and `version` through UNTOUCHED — recomputing either
   * would give one work object two answers, and the optimistic token is the one
   * value where two answers means an operator resolving a conflict by hand.
   */
  describe('story G4 — the token and the actions are the worklist’s, not recomputed', () => {
    it('passes `version` through verbatim, so both surfaces hold one token', async () => {
      const { service } = harness({
        page: { works: [workView({ version: 41 })], total: 1 },
      });

      expect((await service.listBenchWork('viewer-1', true)).works[0].version).toBe(41);
    });

    it('passes `supportedActions` through verbatim rather than deriving its own', async () => {
      // `deriveSupportedActions` runs ONCE, in core, for both surfaces. A bench
      // that filtered this list would offer or withhold an action the planning
      // surface disagrees about — and the disagreement would only show up when
      // an operator's action was refused.
      // Real members of `OperatorInvocableAction` — the union this test's whole
      // subject is that the bench must not touch. `'cancel'` is not one of them
      // (`'force_cancel'` is), and a made-up value here would pass the
      // pass-through assertion while quietly not being the thing under test.
      const actions = ['expedite', 'hold', 'force_cancel'];
      const { service } = harness({
        page: {
          works: [workView({ supportedActions: actions } as Partial<FulfillmentWorkView>)],
          total: 1,
        },
      });

      expect((await service.listBenchWork('viewer-1', true)).works[0].supportedActions).toEqual(actions);
    });

    it('does not withhold actions from a HELD parcel — that is the worklist’s call', async () => {
      // The legitimate divergence, asserted so it is a decision rather than an
      // accident: `state: 'held'` says "do not pack this", and `release_hold`
      // remains perfectly legal on it. A bench that emptied `supportedActions`
      // because it had decided the parcel was unpackable would strand the parcel
      // — the packing verdict is not the planning verdict.
      const { service } = harness({
        page: {
          works: [
            workView({
              activeHolds: [
                {
                  id: 'h-1',
                  reason: 'address-invalid' as const,
                  note: null,
                  placedAt: new Date('2026-09-04T09:00:00Z'),
                },
              ],
              supportedActions: ['release_hold'],
            } as unknown as Partial<FulfillmentWorkView>),
          ],
          total: 1,
        },
      });

      const row = (await service.listBenchWork('viewer-1', true)).works[0];

      expect(row.state).toBe('held');
      expect(row.supportedActions).toEqual(['release_hold']);
    });
  });

  describe('listPackedToday (#3413)', () => {
    it('projects the page, newest-closed first, and reports the reference/buyer name', async () => {
      const older = workView({
        id: 'w-older',
        parcelClosedAt: new Date('2026-09-04T09:00:00Z'),
        packedByUserId: 'user-1',
      });
      const newer = workView({
        id: 'w-newer',
        orderId: 'ol_order_2',
        parcelClosedAt: new Date('2026-09-04T14:00:00Z'),
        packedByUserId: 'user-2',
      });
      const { service } = harness({
        page: { works: [older, newer], total: 2 },
        orders: [
          orderRecord({ internalOrderId: 'ol_order_1' }),
          orderRecord({ internalOrderId: 'ol_order_2', orderSnapshot: { orderNumber: 'OL-9002' } }),
        ],
      });

      const result = await service.listPackedToday(
        new Date('2026-09-04T00:00:00Z'),
        new Date('2026-09-05T00:00:00Z')
      );

      expect(result.total).toBe(2);
      expect(result.works.map((w) => w.workId)).toEqual(['w-newer', 'w-older']);
      expect(result.works[0].closedAt).toBe('2026-09-04T14:00:00.000Z');
      expect(result.works[0].orderReference).toBe('OL-9002');
      expect(result.works[1].packedByUserId).toBe('user-1');
    });

    it('reports an empty list rather than calling the worklist when there is no packing executor', async () => {
      const { service, list } = harness({ connections: [] });

      const result = await service.listPackedToday(new Date(), new Date());

      expect(result).toEqual({ works: [], total: 0 });
      expect(list).not.toHaveBeenCalled();
    });
  });

  describe('getMetrics (#3413)', () => {
    it('reads packedToday, packedYesterday (SAME elapsed window) and toPackAllBenches from three scoped counts', async () => {
      const calls: unknown[] = [];
      const list = jest.fn((filter) => {
        calls.push(filter);
        return Promise.resolve({ works: [], total: calls.length * 10, limit: 1, offset: 0 });
      });

      const connections: IConnectionService = {
        list: jest.fn().mockResolvedValue([connection()]),
      } as unknown as IConnectionService;
      const integrations: IIntegrationsService = {
        resolveAdapterMetadata: jest.fn().mockResolvedValue({ adapterKey: OMS_ADAPTER_KEY }),
      } as unknown as IIntegrationsService;

      const service = new BenchWorkService(
        new BenchExecutorResolver(connections, integrations),
        { list, get: jest.fn(), applyAction: jest.fn(), listSiblingWorkIds: jest.fn() } as never,
        { findByIds: jest.fn() } as unknown as IOrderRecordService,
        { claimParcel: jest.fn() } as never,
        {
          getVariantsByIds: jest.fn().mockResolvedValue([]),
          getProductsByIds: jest.fn().mockResolvedValue([]),
        } as never
      );

      // Built from LOCAL date components rather than a fixed UTC string — the
      // implementation is deliberately server-local (no per-bench timezone
      // concept), so the expectation is computed the same way rather than
      // assuming the test runner's own timezone is UTC.
      const now = new Date();
      now.setHours(14, 30, 0, 0);
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);
      const yesterdayStart = new Date(todayStart);
      yesterdayStart.setDate(yesterdayStart.getDate() - 1);
      const yesterdayCutoff = new Date(yesterdayStart);
      yesterdayCutoff.setHours(14, 30, 0, 0);

      const result = await service.getMetrics(now);

      expect(result).toEqual({ packedToday: 10, packedYesterday: 20, toPackAllBenches: 30 });

      const [todayFilter, yesterdayFilter, backlogFilter] = calls as Array<
        Record<string, unknown>
      >;
      expect(todayFilter.parcelClosedAfter).toEqual(todayStart);
      expect(todayFilter.parcelClosedBefore).toEqual(now);
      // Same ELAPSED window on yesterday, not the whole day — 14:30 of
      // elapsed time, applied to yesterday's midnight.
      expect(yesterdayFilter.parcelClosedAfter).toEqual(yesterdayStart);
      expect(yesterdayFilter.parcelClosedBefore).toEqual(yesterdayCutoff);
      // The backlog count never touches parcelClosedAfter/Before, and
      // excludes `cancelled` from the status set.
      expect(backlogFilter.parcelClosedAfter).toBeUndefined();
      expect(backlogFilter.status).not.toContain('cancelled');
      expect(backlogFilter.parcelClosed).toBe(false);
    });

    it('reports all-zero rather than calling the worklist when there is no packing executor', async () => {
      const { service, list } = harness({ connections: [] });

      const result = await service.getMetrics(new Date());

      expect(result).toEqual({ packedToday: 0, packedYesterday: 0, toPackAllBenches: 0 });
      expect(list).not.toHaveBeenCalled();
    });
  });

  describe('claimNext (#3412)', () => {
    it('delegates the top eligible row to claimParcel', async () => {
      const { service, parcels } = harness({
        page: { works: [workView({ id: 'w-top' })], total: 1 },
      });
      parcels.claimParcel.mockResolvedValue({
        outcome: 'claimed',
        reason: null,
        parcel: { workId: 'w-top' },
      });

      const result = await service.claimNext('viewer-1', true);

      expect(parcels.claimParcel).toHaveBeenCalledWith('w-top', 'viewer-1');
      expect(result).toEqual({ outcome: 'claimed', parcel: { workId: 'w-top' } });
    });

    it('skips a row already claimed by the viewer, in favour of the next eligible one', async () => {
      const { service, parcels } = harness({
        page: {
          works: [
            workView({ id: 'w-mine', assignedToUserId: 'viewer-1', selfServeEligible: false }),
            workView({ id: 'w-next' }),
          ],
          total: 2,
        },
      });
      parcels.claimParcel.mockResolvedValue({
        outcome: 'claimed',
        reason: null,
        parcel: { workId: 'w-next' },
      });

      await service.claimNext('viewer-1', true);

      expect(parcels.claimParcel).toHaveBeenCalledWith('w-next', 'viewer-1');
    });

    it('reports nothing-to-claim when every row is locked to someone else', async () => {
      const { service, parcels } = harness({
        page: {
          works: [
            workView({ id: 'w-locked', assignedToUserId: 'user-9', selfServeEligible: false }),
          ],
          total: 1,
        },
      });

      const result = await service.claimNext('viewer-1', true);

      expect(result).toEqual({ outcome: 'nothing-to-claim' });
      expect(parcels.claimParcel).not.toHaveBeenCalled();
    });

    it('says the claim was REFUSED, not that the queue was empty, when it loses the race', async () => {
      // The two facts are different and used to collapse into one. A candidate
      // was found, so the packer's rail is visibly holding rows; telling them
      // there is nothing to take contradicts what they can see.
      const { service, parcels } = harness({
        page: { works: [workView({ id: 'w-top' })], total: 1 },
      });
      parcels.claimParcel.mockResolvedValue({
        outcome: 'refused',
        reason: 'not-claimable',
        parcel: { workId: 'w-top' },
      });

      const result = await service.claimNext('viewer-1', true);

      expect(result).toEqual({ outcome: 'refused', reason: 'not-claimable' });
    });

    it('carries the refusal reason through rather than flattening every refusal into one', async () => {
      const { service, parcels } = harness({
        page: { works: [workView({ id: 'w-top' })], total: 1 },
      });
      parcels.claimParcel.mockResolvedValue({
        outcome: 'refused',
        reason: 'held',
        parcel: { workId: 'w-top' },
      });

      const result = await service.claimNext('viewer-1', true);

      expect(result).toEqual({ outcome: 'refused', reason: 'held' });
    });

    it('never hands a packer a row their own list would not show them', async () => {
      // This test used to assert the opposite, on the reasoning that an
      // `assigned-other` row is not claimable anyway. It is:
      // `isClaimableByViewer` returns true for anything `selfServeEligible`,
      // and that column defaults true. So reading with `supervises: true`
      // here let "Take next task" hand a packer a parcel their rail had just
      // refused to show them — a control reaching past what the operator can
      // see, on the screen that told them there was nothing there.
      const { service, parcels } = harness({
        page: {
          works: [
            workView({
              id: 'w-selfserve',
              assignedToUserId: 'someone-else',
              selfServeEligible: true,
            }),
          ],
          total: 1,
        },
      });

      const result = await service.claimNext('viewer-1', false);

      expect(parcels.claimParcel).not.toHaveBeenCalled();
      expect(result).toEqual({ outcome: 'nothing-to-claim' });
    });

    it('still offers that row to a supervisor, whose list does show it', async () => {
      // The rule is that the button and the list agree — not that the row is
      // unreachable. A caller who can see it can take it.
      const { service, parcels } = harness({
        page: {
          works: [
            workView({
              id: 'w-selfserve',
              assignedToUserId: 'someone-else',
              selfServeEligible: true,
            }),
          ],
          total: 1,
        },
      });
      parcels.claimParcel.mockResolvedValue({
        outcome: 'claimed',
        reason: null,
        parcel: { workId: 'w-selfserve' },
      });

      const result = await service.claimNext('viewer-1', true);

      expect(parcels.claimParcel).toHaveBeenCalledWith('w-selfserve', 'viewer-1');
      expect(result).toEqual({ outcome: 'claimed', parcel: { workId: 'w-selfserve' } });
    });
  });
});
