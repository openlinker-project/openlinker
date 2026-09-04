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
import { BenchWorkService } from '../services/bench-work.service';

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

  const service = new BenchWorkService(
    connections,
    integrations,
    { list, get: jest.fn(), applyAction: jest.fn(), listSiblingWorkIds: siblings } as never,
    { findByIds } as unknown as IOrderRecordService
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
  };
}

describe('BenchWorkService (#2416)', () => {
  describe('scoping (story B1, decision D8)', () => {
    it('should ask only for work assigned to the packing connection', async () => {
      const { service, list } = harness();

      await service.listBenchWork();

      expect(list).toHaveBeenCalledWith(expect.objectContaining({ assignedConnectionId: ['conn-oms'] }));
    });

    it('should ask only for ACCEPTED work', async () => {
      // A parcel the executor has not taken on is not this bench's work yet,
      // and one it rejected never will be.
      const { service, list } = harness();

      await service.listBenchWork();

      expect(list).toHaveBeenCalledWith(expect.objectContaining({ requestStatus: ['accepted'] }));
    });

    it('should exclude closed and incomplete work, and INCLUDE cancelled', async () => {
      const harnessed = harness();

      await harnessed.service.listBenchWork();

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

      await service.listBenchWork();

      expect(list).toHaveBeenCalledWith(expect.objectContaining({ orderBy: 'createdAt_ASC' }));
    });

    it('should resolve the packing connection through the REGISTRY, not its adapterKey column', async () => {
      // The fixture's `adapterKey` is undefined — what a real row holds. A
      // string compare would match nothing and the bench would report "nothing
      // is set up" for ever.
      const { service } = harness();

      const view = await service.listBenchWork();

      expect(view.routing.ready).toBe(true);
      expect(view.works).toHaveLength(1);
    });

    it('should ignore a connection whose adapter is not the packing one', async () => {
      const { service } = harness({ adapterKey: 'somebody.else.v1' });

      const view = await service.listBenchWork();

      expect(view.routing).toEqual({ ready: false, reason: 'no-packing-connection' });
      expect(view.works).toEqual([]);
    });

    it('should ignore a connection that is not active', async () => {
      const { service } = harness({ connections: [connection({ status: 'disabled' } as never)] });

      expect((await service.listBenchWork()).routing.ready).toBe(false);
    });

    it('should ignore a connection that has not enabled packing', async () => {
      const { service } = harness({
        connections: [connection({ enabledCapabilities: ['OrderSource'] } as never)],
      });

      expect((await service.listBenchWork()).routing.ready).toBe(false);
    });
  });

  describe('the two empty states (story B3)', () => {
    it('should report NOT READY as its own fact rather than as an empty list', async () => {
      const { service } = harness({ connections: [] });

      const view = await service.listBenchWork();

      expect(view.routing).toEqual({ ready: false, reason: 'no-packing-connection' });
      expect(view.executorName).toBeNull();
    });

    it('should report READY with an empty list when there is simply nothing to pack', async () => {
      const { service } = harness({ page: { works: [], total: 0 } });

      const view = await service.listBenchWork();

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

      const view = await service.listBenchWork();

      // 4 total − 1 cancelled = 3. The 3 already "fulfilled" is deliberately
      // not subtracted: OpenLinker cannot see a shelf, and a smaller number
      // here would be a readiness claim.
      expect(view.works[0].unitsToVerify).toBe(3);
    });

    it('should carry the order reference and buyer name, and NOTHING else from the snapshot', async () => {
      const { service } = harness();

      const [row] = (await service.listBenchWork()).works;

      expect(row.orderReference).toBe('OL-4471');
      expect(row.buyerName).toBe('Jan Wiśniewski');
      // The snapshot carries an address; the projection must not.
      expect(JSON.stringify(row)).not.toContain('Secret 1');
    });

    it('should fall back to the internal id when the source names no reference', async () => {
      const { service } = harness({ orders: [orderRecord({ orderSnapshot: {} } as never)] });

      expect((await service.listBenchWork()).works[0].orderReference).toBe('ol_order_1');
    });

    it('should report a MISSING buyer name as null rather than a placeholder', async () => {
      // Ordinary under `OL_STORE_PII=false`: the address is redacted, so there
      // is no name to report.
      const { service } = harness({
        orders: [orderRecord({ orderSnapshot: { orderNumber: 'OL-4471' } } as never)],
      });

      expect((await service.listBenchWork()).works[0].buyerName).toBeNull();
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

      const [row] = (await service.listBenchWork()).works;

      expect(row.state).toBe('held');
      expect(row.holdReason).toBe('address-invalid');
    });

    it('should mark a cancelled parcel cancelled', async () => {
      const { service } = harness({ page: { works: [workView({ status: 'cancelled' })] } });

      expect((await service.listBenchWork()).works[0].state).toBe('cancelled');
    });

    it('should count EVERY parcel of the order, not only the ones on this bench', async () => {
      // A sibling that is closed, held elsewhere or routed to another executor
      // is absent from this page — so counting the page would say "1 of 1"
      // about a split order, precisely where the number matters.
      const { service } = harness({
        siblingIds: new Map([['ol_order_1', ['w-0', 'w-1', 'w-2']]]),
      });

      const [row] = (await service.listBenchWork()).works;

      expect(row.parcelIndex).toBe(2);
      expect(row.parcelTotal).toBe(3);
    });

    it('should say "1 of 1" rather than "of 0" when siblings cannot be read', async () => {
      const { service } = harness({ siblingIds: new Map() });

      const [row] = (await service.listBenchWork()).works;

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

      const view = await service.listBenchWork();

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

      await service.listBenchWork();

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
        { list: jest.fn().mockResolvedValue([connection()]) } as unknown as IConnectionService,
        {
          resolveAdapterMetadata: jest.fn().mockResolvedValue({ adapterKey: OMS_ADAPTER_KEY }),
        } as unknown as IIntegrationsService,
        {
          list,
          get: jest.fn(),
          applyAction: jest.fn(),
          listSiblingWorkIds: jest.fn().mockResolvedValue(new Map()),
        } as never,
        { findByIds: jest.fn().mockResolvedValue([orderRecord()]) } as unknown as IOrderRecordService
      );

      const view = await service.listBenchWork();

      const ids = view.works.map((row) => row.workId);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toHaveLength(101);
      expect(list).toHaveBeenCalledTimes(2);
    });

    it('should report the unpaged total so a truncated list can say so', async () => {
      const { service } = harness({ page: { works: [workView()], total: 900 } });

      expect((await service.listBenchWork()).total).toBe(900);
    });
  });
});
