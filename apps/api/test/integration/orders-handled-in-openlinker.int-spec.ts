/**
 * An order handled in OpenLinker, on /orders (#3482) - integration.
 *
 * The raw SQL this feature adds can only be trusted against real Postgres:
 *
 *  - the health partition twin (`IS_SYNCED_HEALTH`): a handled order is
 *    `awaiting_dispatch` while it is on the bench and `synced` once shipped, and
 *    the buckets still sum to the total;
 *  - the `fulfillment_works` EXISTS behind `onPackBench` and the
 *    `fulfillmentBlockReason` IN-list behind `waitingInOpenLinker`, each with its
 *    count reading the SAME predicate as its filter arm;
 *  - `findProgressByOrderIds`, whose verification EXISTS is what turns a bench
 *    scan into "Packing" (the bench never moves `status`).
 *
 * @module apps/api/test/integration
 */
import {
  FULFILLMENT_WORK_QUERY_SERVICE_TOKEN,
  FULFILLMENT_WORK_REPOSITORY_TOKEN,
  type CreateFulfillmentWorkInput,
  type FulfillmentWork,
  type IFulfillmentWorkQueryService,
} from '@openlinker/core/fulfillment';
import {
  ORDER_RECORD_REPOSITORY_TOKEN,
  type OrderHealthSummary,
  type OrderHealthSummaryFilters,
  type OrderRecordFilters,
  type OrderRecordPagination,
  type PaginatedOrderRecords,
} from '@openlinker/core/orders';
import {
  ORDER_HEALTH_FIXTURES,
  type OrderHealthFixtureBucket,
} from '@openlinker/core/orders/testing';
import { OMS_PLATFORM_TYPE } from '@openlinker/oms';

import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { IntegrationTestHarness } from './setup';
import { createTestConnection } from './helpers/test-connection.helper';
import { createTestOrderRecord } from './fixtures/order.fixtures';

/**
 * The two reads this spec drives, as a LOCAL structural view. The
 * `*RepositoryPort` type is a deny shape for cross-context imports
 * (`check-cross-context-imports.mjs`), and an allow-list row would be a standing
 * licence for the coupling; the token is permitted, so the repository is
 * resolved by token and typed by what this spec actually calls.
 */
interface OrderRecordReadsView {
  findMany(
    filters: OrderRecordFilters,
    pagination: OrderRecordPagination
  ): Promise<PaginatedOrderRecords>;
  countByHealth(filters: OrderHealthSummaryFilters): Promise<OrderHealthSummary>;
}

/** The repository port is off the barrel; see `bench-work.int-spec.ts`. */
interface WorkFactoryView {
  create(input: CreateFulfillmentWorkInput): Promise<FulfillmentWork>;
}

const SOURCE = '11111111-1111-4111-8111-111111111111';
const PACKER = '44444444-4444-4444-8444-444444444444';

describe('Orders handled in OpenLinker (#3482, integration)', () => {
  let harness: IntegrationTestHarness;
  let orders: OrderRecordReadsView;

  beforeAll(async () => {
    harness = await getTestHarness();
    orders = harness.getApp().get<OrderRecordReadsView>(ORDER_RECORD_REPOSITORY_TOKEN);
  });
  afterEach(async () => {
    await resetTestHarness();
  });
  afterAll(async () => {
    await teardownTestHarness();
  });

  async function seedOrder(
    internalOrderId: string,
    overrides: Record<string, unknown> = {}
  ): Promise<void> {
    await createTestOrderRecord(harness.getDataSource(), {
      internalOrderId,
      sourceConnectionId: SOURCE,
      recordStatus: 'ready',
      syncStatus: [],
      ...overrides,
    });
  }

  async function seedWork(orderId: string): Promise<FulfillmentWork> {
    const dataSource = harness.getDataSource();
    const oms = await createTestConnection(dataSource, {
      platformType: OMS_PLATFORM_TYPE,
      name: `Warehouse packing ${orderId}`,
      status: 'active',
      adapterKey: null as unknown as undefined,
      credentialsRef: '',
      enabledCapabilities: ['FulfillmentExecutor'],
      config: {},
    });
    const works = harness.getApp().get<WorkFactoryView>(FULFILLMENT_WORK_REPOSITORY_TOKEN);
    return works.create({
      orderId,
      locationId: 'ol_location_1',
      deliveryMethod: 'courier',
      assignedConnectionId: oms.id,
      lines: [{ orderLineId: 'l-1', productVariantId: 'ol_variant_1', totalQuantity: 1 }],
    });
  }

  async function setWork(workId: string, sql: string, params: unknown[] = []): Promise<void> {
    await harness
      .getDataSource()
      .query(`UPDATE "fulfillment_works" SET ${sql} WHERE "id" = $${params.length + 1}`, [
        ...params,
        workId,
      ]);
  }

  async function addScan(workId: string, voided = false): Promise<void> {
    const dataSource = harness.getDataSource();
    const [line] = await dataSource.query<{ id: string }[]>(
      `SELECT "id" FROM "fulfillment_work_lines" WHERE "fulfillmentWorkId" = $1 LIMIT 1`,
      [workId]
    );
    await dataSource.query(
      `INSERT INTO "fulfillment_work_verifications"
         ("id", "fulfillmentWorkId", "workLineId", "gestureId", "verifiedByUserId", "verifiedAt", "voidedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, now(), $5)`,
      [workId, line.id, `g-${Math.random()}`, PACKER, voided ? new Date() : null]
    );
  }

  describe('health partition', () => {
    // The SQL half of the rule the frontend's `deriveOrderHealth` implements too.
    // Every row of the shared table is seeded and must land in EXACTLY the bucket
    // it expects - the NULL-`fulfillmentState` row is the one an order sitting on
    // the bench is, and a bare `IN (...)` once counted it in no bucket at all.
    it('should place every shared fixture in exactly the bucket it expects, and the buckets sum to the total', async () => {
      expect(ORDER_HEALTH_FIXTURES.length).toBeGreaterThan(0);
      const ids = new Map<string, string>();
      for (const [index, fixture] of ORDER_HEALTH_FIXTURES.entries()) {
        const id = `ol_order_health_fx_${index}`;
        ids.set(id, fixture.name);
        await seedOrder(id, {
          recordStatus: fixture.recordStatus,
          fulfillmentState: fixture.fulfillmentState as never,
          syncStatus: fixture.syncStatuses.map((status, i) => ({
            destinationConnectionId: `22222222-2222-4222-8222-22222222222${i}`,
            status,
          })) as never,
        });
        if (fixture.liveWork) await seedWork(id);
      }

      const buckets: OrderHealthFixtureBucket[] = [
        'source_deleted',
        'awaiting_mapping',
        'needs_attention',
        'synced',
        'awaiting_dispatch',
      ];
      const seen = new Map<string, OrderHealthFixtureBucket[]>();
      for (const bucket of buckets) {
        const page = await orders.findMany({ health: bucket }, { limit: 100, offset: 0 });
        for (const record of page.items) {
          seen.set(record.internalOrderId, [...(seen.get(record.internalOrderId) ?? []), bucket]);
        }
      }

      for (const [index, fixture] of ORDER_HEALTH_FIXTURES.entries()) {
        const id = `ol_order_health_fx_${index}`;
        expect({ fixture: fixture.name, buckets: seen.get(id) ?? [] }).toEqual({
          fixture: fixture.name,
          buckets: [fixture.expected],
        });
      }

      const summary = await orders.countByHealth({});
      expect(summary.total).toBe(ORDER_HEALTH_FIXTURES.length);
      expect(
        summary.sourceDeleted +
          summary.awaitingMapping +
          summary.needsAttention +
          summary.synced +
          summary.awaitingDispatch
      ).toBe(summary.total);
    });

    it('should keep a handled order awaiting dispatch on the bench and count it synced once shipped', async () => {
      await seedOrder('ol_order_on_bench', { fulfillmentState: 'not-shipped' });
      await seedWork('ol_order_on_bench');
      await seedOrder('ol_order_shipped', { fulfillmentState: 'delivered' });
      await seedWork('ol_order_shipped');
      // Shipped but NOT handled: nothing configured, the marketplace shipped it.
      // Must keep its old bucket, so non-OMS installs see no change.
      await seedOrder('ol_order_not_handled', { fulfillmentState: 'delivered' });

      const summary = await orders.countByHealth({});

      expect(summary.synced).toBe(1);
      expect(summary.awaitingDispatch).toBe(2);
      expect(
        summary.sourceDeleted +
          summary.awaitingMapping +
          summary.needsAttention +
          summary.synced +
          summary.awaitingDispatch
      ).toBe(summary.total);

      const synced = await orders.findMany({ health: 'synced' }, { limit: 10, offset: 0 });
      expect(synced.items.map((o) => o.internalOrderId)).toEqual(['ol_order_shipped']);
    });

    it('should not count a cancelled work as handled', async () => {
      await seedOrder('ol_order_cancelled_work', { fulfillmentState: 'delivered' });
      const work = await seedWork('ol_order_cancelled_work');
      await setWork(work.id, `"status" = 'cancelled', "cancellationReason" = 'operator_forced'`);

      const summary = await orders.countByHealth({});

      expect(summary.synced).toBe(0);
      expect(summary.awaitingDispatch).toBe(1);
    });
  });

  describe('on pack bench', () => {
    it('should count and filter orders whose box is not shut, and exclude packed ones', async () => {
      await seedOrder('ol_order_to_pack');
      await seedWork('ol_order_to_pack');
      await seedOrder('ol_order_packed');
      const packed = await seedWork('ol_order_packed');
      await setWork(packed.id, `"parcelClosedAt" = now(), "packedByUserId" = $1`, [PACKER]);
      await seedOrder('ol_order_no_work');

      const summary = await orders.countByHealth({});
      const on = await orders.findMany({ onPackBench: true }, { limit: 10, offset: 0 });
      const off = await orders.findMany({ onPackBench: false }, { limit: 10, offset: 0 });

      expect(summary.onPackBench).toBe(1);
      expect(on.items.map((o) => o.internalOrderId)).toEqual(['ol_order_to_pack']);
      expect(off.items.map((o) => o.internalOrderId).sort()).toEqual(
        ['ol_order_no_work', 'ol_order_packed'].sort()
      );
    });
  });

  describe('waiting in OpenLinker', () => {
    it('should count and filter the three waiting reasons, with the oldest wait, and nothing else', async () => {
      await seedOrder('ol_order_waiting_stock', {
        fulfillmentBlockReason: 'routing-refused',
        fulfillmentBlockedAt: new Date('2026-10-23T07:00:00Z'),
      });
      await seedOrder('ol_order_waiting_address', {
        fulfillmentBlockReason: 'routing-no-shipping-address',
        fulfillmentBlockedAt: new Date('2026-10-23T09:00:00Z'),
      });
      // A transient guard, not "waiting".
      await seedOrder('ol_order_in_doubt', { fulfillmentBlockReason: 'routing-in-doubt' });
      await seedOrder('ol_order_plain');

      const summary = await orders.countByHealth({});
      const on = await orders.findMany({ waitingInOpenLinker: true }, { limit: 10, offset: 0 });
      const off = await orders.findMany({ waitingInOpenLinker: false }, { limit: 10, offset: 0 });

      expect(summary.waitingInOpenLinker).toBe(2);
      expect(summary.waitingInOpenLinkerOldestAt?.toISOString()).toBe('2026-10-23T07:00:00.000Z');
      expect(on.items.map((o) => o.internalOrderId).sort()).toEqual(
        ['ol_order_waiting_address', 'ol_order_waiting_stock'].sort()
      );
      // The NULL reason must be kept by the negation (`NOT (NULL IN ...)` drops it).
      expect(off.items.map((o) => o.internalOrderId).sort()).toEqual(
        ['ol_order_in_doubt', 'ol_order_plain'].sort()
      );
    });
  });

  describe('packing stage from the live work rows', () => {
    function query(): IFulfillmentWorkQueryService {
      return harness
        .getApp()
        .get<IFulfillmentWorkQueryService>(FULFILLMENT_WORK_QUERY_SERVICE_TOKEN);
    }

    it('should read To pack, Packing after a scan, and Packed once the box is shut', async () => {
      const toPack = await seedWork('ol_order_stage_to_pack');
      const scanned = await seedWork('ol_order_stage_scanned');
      await addScan(scanned.id);
      const voidedOnly = await seedWork('ol_order_stage_voided');
      await addScan(voidedOnly.id, true);
      const shut = await seedWork('ol_order_stage_shut');
      await setWork(shut.id, `"parcelClosedAt" = now(), "packedByUserId" = $1`, [PACKER]);

      const summaries = await query().summarizeWorkForOrders([
        'ol_order_stage_to_pack',
        'ol_order_stage_scanned',
        'ol_order_stage_voided',
        'ol_order_stage_shut',
      ]);

      expect(toPack.status).toBe('open');
      expect(summaries.get('ol_order_stage_to_pack')?.stage).toBe('to-pack');
      expect(summaries.get('ol_order_stage_scanned')?.stage).toBe('packing');
      // A voided scan is not packing.
      expect(summaries.get('ol_order_stage_voided')?.stage).toBe('to-pack');
      expect(summaries.get('ol_order_stage_shut')?.stage).toBe('packed');
    });

    it('should report the assigned packer, or Unassigned as null', async () => {
      const assigned = await seedWork('ol_order_assigned');
      await setWork(assigned.id, `"assignedToUserId" = $1`, [PACKER]);
      await seedWork('ol_order_unassigned');

      const summaries = await query().summarizeWorkForOrders([
        'ol_order_assigned',
        'ol_order_unassigned',
      ]);

      expect(summaries.get('ol_order_assigned')).toMatchObject({
        assignment: 'single',
        assignedToUserId: PACKER,
      });
      expect(summaries.get('ol_order_unassigned')).toMatchObject({
        assignment: 'single',
        assignedToUserId: null,
      });
    });
  });
});
