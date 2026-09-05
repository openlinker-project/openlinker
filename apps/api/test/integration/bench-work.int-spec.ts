/**
 * Bench work list — `GET /bench/work` (#2416, `W3b-3`, spec § 2.2)
 *
 * Asserts the deployed surface, through the real guard stack and a real
 * Postgres.
 *
 * ## What only an integration test can prove here
 *
 * Two things. That a `packer` REACHES this route — it is the first route in the
 * tree granted to that role, and #2413's whole authorization posture is that a
 * packer is refused everywhere unless a grant is recorded, so "the decorator is
 * present" and "the session gets through" are different claims. And that a
 * `viewer` does NOT: the response carries a buyer name, and the unit test can
 * only read a decorator.
 *
 * And that decision D8 holds against real rows: a parcel routed to a logistics
 * provider must never appear here. The service spec proves the filter is ASKED
 * for — a claim about a call — while only a database can settle which rows come
 * back. The PROJECTION rules (units to verify, the parcel count, the buyer-name
 * allowlist) stay in the service spec, where each can be driven directly.
 *
 * @module apps/api/test/integration
 */
import {
  FULFILLMENT_WORK_REPOSITORY_TOKEN,
  type CreateFulfillmentWorkInput,
  type FulfillmentWork,
} from '@openlinker/core/fulfillment';
import { OMS_PLATFORM_TYPE } from '@openlinker/oms';

import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { IntegrationTestHarness } from './setup';
import { loginAsPacker, loginAsViewer } from './helpers/test-auth.helper';
import { createTestConnection } from './helpers/test-connection.helper';

/** See `fulfillment-expedite.int-spec.ts` — the port is off the barrel. */
interface WorkFactoryView {
  create(input: CreateFulfillmentWorkInput): Promise<FulfillmentWork>;
}

describe('Bench work list (#2416)', () => {
  let harness: IntegrationTestHarness;

  beforeAll(async () => {
    harness = await getTestHarness();
  });

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  it('lets a packer read the bench work list', async () => {
    const http = harness.getHttp();
    const token = await loginAsPacker(http, harness.getDataSource());

    const res = await http
      .get('/v1/bench/work')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(res.body.works)).toBe(true);
    expect(typeof res.body.total).toBe('number');
  });

  it('reports that no work can arrive rather than an unexplained empty list', async () => {
    // A fresh install has no OMS connection, so this is the not-routed state —
    // and it is the one an operator most needs told apart from an empty queue
    // (story B3). An empty `works` array alone cannot say which it is.
    const http = harness.getHttp();
    const token = await loginAsPacker(http, harness.getDataSource());

    const res = await http
      .get('/v1/bench/work')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.routing).toEqual({ ready: false, reason: 'no-packing-connection' });
    expect(res.body.works).toEqual([]);
    expect(res.body.executorName).toBeNull();
  });

  it('shows the packing work and NEVER a parcel routed to a logistics provider (D8)', async () => {
    // The end-to-end half of decision D8, with a real OMS connection resolved
    // through the registry and a rival executor's work in the same table. The
    // service spec proves the filter is ASKED for; only this proves the rows
    // that come back.
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();

    const oms = await createTestConnection(dataSource, {
      platformType: OMS_PLATFORM_TYPE,
      name: 'Warehouse packing',
      status: 'active',
      // NULL, exactly as the connection form leaves it — the registry resolves
      // the default adapter key. A bench that compared this column would find
      // nothing here.
      adapterKey: null as unknown as undefined,
      credentialsRef: '',
      enabledCapabilities: ['FulfillmentExecutor'],
      config: {},
    });
    const thirdParty = await createTestConnection(dataSource, {
      platformType: 'prestashop',
      name: 'A logistics provider',
      status: 'active',
      enabledCapabilities: ['FulfillmentExecutor'],
    });

    const works = harness.getApp().get<WorkFactoryView>(FULFILLMENT_WORK_REPOSITORY_TOKEN);
    const seed = async (orderId: string, connectionId: string): Promise<FulfillmentWork> => {
      const work = await works.create({
        orderId,
        locationId: 'ol_location_1',
        deliveryMethod: 'courier',
        assignedConnectionId: connectionId,
        lines: [{ orderLineId: 'l-1', productVariantId: 'ol_variant_1', totalQuantity: 2 }],
      });
      // Story B1's "accepted" — the bench lists only work its executor took on.
      await dataSource.query(
        `UPDATE "fulfillment_works" SET "requestStatus" = 'accepted' WHERE "id" = $1`,
        [work.id]
      );
      return work;
    };

    const mine = await seed('ol_order_bench', oms.id);
    const theirs = await seed('ol_order_3pl', thirdParty.id);

    const token = await loginAsPacker(http, dataSource);
    const res = await http
      .get('/v1/bench/work')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.routing).toEqual({ ready: true, reason: null });
    expect(res.body.executorName).toBe('Warehouse packing');
    const ids = (res.body.works as { workId: string }[]).map((row) => row.workId);
    expect(ids).toContain(mine.id);
    expect(ids).not.toContain(theirs.id);
  });

  it('refuses a viewer, whose role has no business reading a buyer name at a bench', async () => {
    const http = harness.getHttp();
    const token = await loginAsViewer(http, harness.getDataSource());

    await http.get('/v1/bench/work').set('Authorization', `Bearer ${token}`).expect(403);
  });

  it('refuses an anonymous request', async () => {
    await harness.getHttp().get('/v1/bench/work').expect(401);
  });
});
