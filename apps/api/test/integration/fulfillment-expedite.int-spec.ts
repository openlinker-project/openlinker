/**
 * Expedite and the bench's SQL reads (#2416, `W3b-3`, spec D22, story B1/D8)
 *
 * Everything #2416 added below the service seam, against real Postgres.
 *
 * ## Why this cannot be a unit test
 *
 * All four paths here ARE SQL. `setExpedited`'s replay refusal is a conditional
 * UPDATE's `IS NULL` / `IS NOT NULL` predicate; the bench's holder scope is an
 * `IN (...)` and its empty case a literal `1 = 0`; the selection direction is an
 * `ORDER BY`; and the sibling count is a second query's `ORDER BY` and grouping.
 * A mock can only prove that a filter object was passed — which is what the
 * service spec asserts, and it is a claim about a call, not about which rows
 * come back. D8's whole point is that a parcel routed to a logistics provider
 * never reaches this bench, and only the database can settle that.
 *
 * @module apps/api/test/integration
 */
import {
  FULFILLMENT_WORK_REPOSITORY_TOKEN,
  FULFILLMENT_WORKLIST_SERVICE_TOKEN,
  FulfillmentWorkActionNotLegalError,
  FulfillmentWorkVersionConflictError,
  type CreateFulfillmentWorkInput,
  type FulfillmentWork,
  type FulfillmentWorkListFilter,
  type FulfillmentWorkPage,
  type IFulfillmentWorklistService,
} from '@openlinker/core/fulfillment';

import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

/**
 * A LOCAL structural view of the repository — the port is intra-context and
 * deliberately off the barrel (deny pattern), the `fulfillment-worklist.int-spec.ts`
 * precedent.
 */
interface WorkRepositoryView {
  create(input: CreateFulfillmentWorkInput): Promise<FulfillmentWork>;
  listWorks(filter: FulfillmentWorkListFilter): Promise<FulfillmentWorkPage>;
  listWorkIdsByOrderIds(orderIds: readonly string[]): Promise<Map<string, string[]>>;
  setExpedited(input: {
    workId: string;
    expeditedAt: Date | null;
    expectedVersion?: number;
  }): Promise<boolean>;
  findById(workId: string): Promise<FulfillmentWork | null>;
}

/**
 * `assignedConnectionId` is a `uuid` COLUMN, so a readable placeholder such as
 * `'conn-oms'` fails the INSERT with a driver-level type error rather than
 * telling you anything about the filter under test. Named constants keep these
 * tests readable without pretending the column is free text.
 */
const OMS_CONNECTION_ID = '11111111-1111-4111-8111-111111111111';
const THIRD_PARTY_CONNECTION_ID = '22222222-2222-4222-8222-222222222222';

describe('Expedite and the bench reads (#2416)', () => {
  let harness: IntegrationTestHarness;
  let worklist: IFulfillmentWorklistService;
  let works: WorkRepositoryView;

  beforeAll(async () => {
    harness = await getTestHarness();
    worklist = harness
      .getApp()
      .get<IFulfillmentWorklistService>(FULFILLMENT_WORKLIST_SERVICE_TOKEN);
    works = harness.getApp().get<WorkRepositoryView>(FULFILLMENT_WORK_REPOSITORY_TOKEN);
  });
  afterEach(async () => {
    await resetTestHarness();
  });
  afterAll(async () => {
    await teardownTestHarness();
  });

  const createWork = async (
    over: Partial<CreateFulfillmentWorkInput> = {}
  ): Promise<FulfillmentWork> =>
    works.create({
      orderId: 'ol_order_expedite',
      locationId: 'ol_location_1',
      deliveryMethod: 'courier',
      assignedConnectionId: null,
      lines: [{ orderLineId: 'line-1', productVariantId: 'ol_variant_1', totalQuantity: 5 }],
      ...over,
    });

  describe('setExpedited (D22)', () => {
    it('should stamp an instant, and offer only the REVERSE verb afterwards', async () => {
      const work = await createWork();

      const after = await worklist.applyAction({
        workId: work.id,
        action: 'expedite',
        expectedVersion: work.version,
      });

      expect(after.expeditedAt).not.toBeNull();
      // Exactly one direction is ever offered — the server decides which way the
      // control points, so no client has to.
      expect(after.supportedActions).toContain('release_expedite');
      expect(after.supportedActions).not.toContain('expedite');
    });

    it('should be REVERSIBLE, because a permanent override is a second deadline system', async () => {
      const work = await createWork();
      const expedited = await worklist.applyAction({
        workId: work.id,
        action: 'expedite',
        expectedVersion: work.version,
      });

      const released = await worklist.applyAction({
        workId: work.id,
        action: 'release_expedite',
        expectedVersion: expedited.version,
      });

      expect(released.expeditedAt).toBeNull();
      expect(released.supportedActions).toContain('expedite');
    });

    it('should REFUSE a replay rather than re-stamping the instant', async () => {
      // Re-stamping would move this parcel behind everything pushed since —
      // silently, under a packer, which is what D22 says a list must never do.
      const work = await createWork();
      const expedited = await worklist.applyAction({
        workId: work.id,
        action: 'expedite',
        expectedVersion: work.version,
      });
      const stampedAt = expedited.expeditedAt;

      await expect(
        worklist.applyAction({
          workId: work.id,
          action: 'expedite',
          expectedVersion: expedited.version,
        })
      ).rejects.toBeInstanceOf(FulfillmentWorkActionNotLegalError);

      const reread = await works.findById(work.id);
      expect(reread?.expeditedAt?.toISOString()).toBe(stampedAt?.toISOString());
    });

    it('should refuse a STALE token, and say so differently from an illegal action', async () => {
      const work = await createWork();
      await worklist.applyAction({
        workId: work.id,
        action: 'expedite',
        expectedVersion: work.version,
      });

      // The ORIGINAL token, now one version behind.
      await expect(
        worklist.applyAction({
          workId: work.id,
          action: 'release_expedite',
          expectedVersion: work.version,
        })
      ).rejects.toBeInstanceOf(FulfillmentWorkVersionConflictError);
    });

    it('should refuse both verbs on a terminal parcel', async () => {
      const work = await createWork();
      const cancelled = await worklist.applyAction({
        workId: work.id,
        action: 'force_cancel',
        expectedVersion: work.version,
      });

      expect(cancelled.supportedActions).toEqual([]);
      await expect(
        worklist.applyAction({
          workId: work.id,
          action: 'expedite',
          expectedVersion: cancelled.version,
        })
      ).rejects.toBeInstanceOf(FulfillmentWorkActionNotLegalError);
    });

    it('should bump the version, so a peer holding the old one is refused', async () => {
      const work = await createWork();

      const applied = await works.setExpedited({
        workId: work.id,
        expeditedAt: new Date(),
        expectedVersion: work.version,
      });

      expect(applied).toBe(true);
      expect((await works.findById(work.id))?.version).toBeGreaterThan(work.version);
    });
  });

  describe('the holder scope (story B1, decision D8)', () => {
    it('should return ONLY work assigned to the named connections', async () => {
      // The case D8 exists for: a parcel routed to a logistics provider must
      // never reach the in-house bench.
      const mine = await createWork({ orderId: 'ol_order_a', assignedConnectionId: OMS_CONNECTION_ID });
      await createWork({ orderId: 'ol_order_b', assignedConnectionId: THIRD_PARTY_CONNECTION_ID });

      const page = await works.listWorks({ assignedConnectionId: [OMS_CONNECTION_ID] });

      expect(page.works.map((w) => w.id)).toEqual([mine.id]);
      expect(page.total).toBe(1);
    });

    it('should return NOTHING for an empty connection list, never everything', async () => {
      // An empty list is a positive statement — "these zero connections" — and
      // reading it as "any" would show a bench every executor's work. `IN ()` is
      // a syntax error rather than an empty set, so this is the `1 = 0` arm.
      await createWork({ assignedConnectionId: OMS_CONNECTION_ID });

      const page = await works.listWorks({ assignedConnectionId: [] });

      expect(page.works).toEqual([]);
      expect(page.total).toBe(0);
    });

    it('should be unfiltered when the axis is OMITTED, so every existing caller is unchanged', async () => {
      await createWork({ orderId: 'ol_order_a', assignedConnectionId: OMS_CONNECTION_ID });
      await createWork({ orderId: 'ol_order_b', assignedConnectionId: THIRD_PARTY_CONNECTION_ID });

      expect((await works.listWorks({})).total).toBe(2);
    });
  });

  describe('the selection order (#2416 F2)', () => {
    it('should take the OLDEST rows when a page is bounded, not the newest', async () => {
      // The bench sorts by the ORDER's deadline afterwards, so this direction
      // decides only WHICH rows survive truncation. Newest-first would drop the
      // most overdue under a heading promising the most urgent first.
      const first = await createWork({ orderId: 'ol_order_1' });
      await createWork({ orderId: 'ol_order_2' });
      const third = await createWork({ orderId: 'ol_order_3' });

      const oldest = await works.listWorks({ orderBy: 'createdAt_ASC', limit: 1 });
      expect(oldest.works.map((w) => w.id)).toEqual([first.id]);

      // And the default is unchanged, which is what keeps every pre-#2416
      // caller byte-identical.
      const newest = await works.listWorks({ limit: 1 });
      expect(newest.works.map((w) => w.id)).toEqual([third.id]);
    });
  });

  describe('listWorkIdsByOrderIds (#2416 F3)', () => {
    it('should count EVERY parcel of an order, whatever its state and holder', async () => {
      // A filtered read cannot answer "parcel 1 of 2" — a sibling that is
      // closed, held elsewhere or routed to another executor is absent from it,
      // so the count would be wrong exactly on the split orders it exists for.
      const a = await createWork({ orderId: 'ol_order_split', assignedConnectionId: OMS_CONNECTION_ID });
      const b = await createWork({ orderId: 'ol_order_split', assignedConnectionId: THIRD_PARTY_CONNECTION_ID });
      await worklist.applyAction({
        workId: b.id,
        action: 'force_cancel',
        expectedVersion: b.version,
      });

      const byOrder = await works.listWorkIdsByOrderIds(['ol_order_split']);

      expect(byOrder.get('ol_order_split')).toHaveLength(2);
      // Ordered `createdAt, id`, so a parcel's index is stable across reads.
      expect(byOrder.get('ol_order_split')?.[0]).toBe(a.id);
    });

    it('should answer an empty ask without touching the database', async () => {
      expect(await works.listWorkIdsByOrderIds([])).toEqual(new Map());
    });

    it('should omit an order it has no work for', async () => {
      await createWork({ orderId: 'ol_order_known' });

      const byOrder = await works.listWorkIdsByOrderIds(['ol_order_known', 'ol_order_absent']);

      expect(byOrder.has('ol_order_known')).toBe(true);
      expect(byOrder.has('ol_order_absent')).toBe(false);
    });
  });
});
