/**
 * Opening, verifying and reopening one parcel (#2418, `W3b-5`, spec §§ 2.4–2.6)
 *
 * Asserts the deployed surface, through the real guard stack and a real
 * Postgres.
 *
 * ## What only an integration test can prove here
 *
 * Four things, and each of them is a claim about the DATABASE rather than about
 * a call:
 *
 * 1. **The box shuts itself on the last verification** (D18) — the close is a
 *    guarded UPDATE inside the same transaction as the ledger insert, and a unit
 *    test with a mocked repository proves only that the method was called.
 * 2. **Over-packing is refused and the count does not move** (E3), enforced
 *    under a real row lock.
 * 3. **One physical gesture is recorded once** — the uniqueness key is an index,
 *    and an index is only real in a database.
 * 4. **A packer still cannot reach `/orders` or the invoicing register.** The
 *    two work-scoped routes this issue adds are the REPLACEMENTS for those; a
 *    replacement that quietly reopened what it replaced would be worse than not
 *    having built it.
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
import { loginAsPacker } from './helpers/test-auth.helper';
import { createTestConnection } from './helpers/test-connection.helper';

/** See `bench-work.int-spec.ts` — the repository port is off the barrel. */
interface WorkFactoryView {
  create(input: CreateFulfillmentWorkInput): Promise<FulfillmentWork>;
}

interface ParcelBody {
  workId: string;
  version: number;
  parcelIndex: number;
  parcelTotal: number;
  refusal: string | null;
  closedAt: string | null;
  packedByUserId: string | null;
  lines: { workLineId: string; requiredQuantity: number; verifiedQuantity: number }[];
}

describe('Bench parcel (#2418)', () => {
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

  /**
   * One accepted parcel routed to OpenLinker's own packing executor.
   *
   * `adapterKey` is left NULL exactly as the connection form leaves it — the
   * registry resolves the default — because a bench that compared that column
   * would find nothing on any real install.
   */
  async function seedParcel(totalQuantity = 2): Promise<FulfillmentWork> {
    const dataSource = harness.getDataSource();
    const oms = await createTestConnection(dataSource, {
      platformType: OMS_PLATFORM_TYPE,
      name: 'Warehouse packing',
      status: 'active',
      adapterKey: null as unknown as undefined,
      credentialsRef: '',
      enabledCapabilities: ['FulfillmentExecutor'],
      config: {},
    });

    const works = harness.getApp().get<WorkFactoryView>(FULFILLMENT_WORK_REPOSITORY_TOKEN);
    const work = await works.create({
      orderId: 'ol_order_bench_parcel',
      locationId: 'ol_location_1',
      deliveryMethod: 'courier',
      assignedConnectionId: oms.id,
      lines: [{ orderLineId: 'l-1', productVariantId: 'ol_variant_1', totalQuantity }],
    });
    await dataSource.query(
      `UPDATE "fulfillment_works" SET "requestStatus" = 'accepted' WHERE "id" = $1`,
      [work.id]
    );
    return work;
  }

  it('opens a parcel and reports what must go in the box', async () => {
    const http = harness.getHttp();
    const work = await seedParcel(2);
    const token = await loginAsPacker(http, harness.getDataSource());

    const res = await http
      .get(`/v1/bench/work/${work.id}/parcel`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as ParcelBody;
    expect(body.workId).toBe(work.id);
    expect(body.refusal).toBeNull();
    expect(body.closedAt).toBeNull();
    // Story D3 — always explicit about which box this is, never suppressed for a
    // single-parcel order.
    expect(body.parcelIndex).toBe(1);
    expect(body.parcelTotal).toBe(1);
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0].requiredQuantity).toBe(2);
    expect(body.lines[0].verifiedQuantity).toBe(0);
  });

  it('carries no buyer address, email, phone or total — the reason /orders is closed', async () => {
    const http = harness.getHttp();
    const work = await seedParcel();
    const token = await loginAsPacker(http, harness.getDataSource());

    const res = await http
      .get(`/v1/bench/work/${work.id}/parcel`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // Asserted over the SERIALISED body rather than field by field: a nested
    // field added anywhere under this projection would escape a per-key check.
    const serialised = JSON.stringify(res.body);
    for (const forbidden of [
      'shippingAddress',
      'billingAddress',
      'address1',
      'postcode',
      'customerEmail',
      'phone',
      'totalAmount',
      'orderSnapshot',
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
  });

  it('shuts the box on the LAST verification, with nothing pressed (D18)', async () => {
    const http = harness.getHttp();
    const work = await seedParcel(2);
    const token = await loginAsPacker(http, harness.getDataSource());
    const lineId = (
      await http
        .get(`/v1/bench/work/${work.id}/parcel`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
    ).body.lines[0].workLineId as string;

    const first = await http
      .post(`/v1/bench/work/${work.id}/verifications`)
      .set('Authorization', `Bearer ${token}`)
      .send({ workLineId: lineId, gestureId: 'gesture-1' })
      .expect(201);
    expect(first.body.outcome).toBe('verified');
    expect(first.body.parcel.closedAt).toBeNull();

    const second = await http
      .post(`/v1/bench/work/${work.id}/verifications`)
      .set('Authorization', `Bearer ${token}`)
      .send({ workLineId: lineId, gestureId: 'gesture-2' })
      .expect(201);

    expect(second.body.outcome).toBe('verified');
    expect(second.body.parcel.closedAt).not.toBeNull();
    // D13: the last verifier owns the parcel.
    expect(second.body.parcel.packedByUserId).not.toBeNull();

    const row = (await harness
      .getDataSource()
      .query(`SELECT "parcelClosedAt", "packedByUserId" FROM "fulfillment_works" WHERE "id" = $1`, [
        work.id,
      ])) as { parcelClosedAt: Date | null; packedByUserId: string | null }[];
    expect(row[0].parcelClosedAt).not.toBeNull();
    expect(row[0].packedByUserId).not.toBeNull();
  });

  it('refuses an extra unit into a full line and leaves the count alone (E3)', async () => {
    const http = harness.getHttp();
    const dataSource = harness.getDataSource();
    // TWO lines, so filling the first cannot shut the box — otherwise the extra
    // scan is refused as `parcel-closed` and the over-pack guard is never
    // reached. That is exactly what the first version of this test did.
    const oms = await createTestConnection(dataSource, {
      platformType: OMS_PLATFORM_TYPE,
      name: 'Warehouse packing',
      status: 'active',
      adapterKey: null as unknown as undefined,
      credentialsRef: '',
      enabledCapabilities: ['FulfillmentExecutor'],
      config: {},
    });
    const works = harness.getApp().get<WorkFactoryView>(FULFILLMENT_WORK_REPOSITORY_TOKEN);
    const work = await works.create({
      orderId: 'ol_order_overpack',
      locationId: 'ol_location_1',
      deliveryMethod: 'courier',
      assignedConnectionId: oms.id,
      lines: [
        { orderLineId: 'l-1', productVariantId: 'ol_variant_1', totalQuantity: 2 },
        { orderLineId: 'l-2', productVariantId: 'ol_variant_2', totalQuantity: 1 },
      ],
    });
    await dataSource.query(
      `UPDATE "fulfillment_works" SET "requestStatus" = 'accepted' WHERE "id" = $1`,
      [work.id]
    );

    const token = await loginAsPacker(http, dataSource);
    const parcel = (
      await http
        .get(`/v1/bench/work/${work.id}/parcel`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
    ).body as ParcelBody;
    const twoUnitLine = parcel.lines.find((l) => l.requiredQuantity === 2)?.workLineId as string;

    for (const gestureId of ['g-1', 'g-2']) {
      await http
        .post(`/v1/bench/work/${work.id}/verifications`)
        .set('Authorization', `Bearer ${token}`)
        .send({ workLineId: twoUnitLine, gestureId })
        .expect(201);
    }

    const extra = await http
      .post(`/v1/bench/work/${work.id}/verifications`)
      .set('Authorization', `Bearer ${token}`)
      .send({ workLineId: twoUnitLine, gestureId: 'g-3' })
      .expect(201);

    expect(extra.body.outcome).toBe('refused');
    expect(extra.body.reason).toBe('over-packed');
    // The box is still open — the second line is outstanding — so this is the
    // over-pack guard and not the closed-parcel one.
    expect(extra.body.parcel.closedAt).toBeNull();
    const line = (extra.body.parcel as ParcelBody).lines.find(
      (l) => l.workLineId === twoUnitLine
    );
    expect(line?.verifiedQuantity).toBe(2);

    // Records NOTHING: no ledger row, and the gesture id is not consumed.
    const ledger = (await dataSource.query(
      `SELECT COUNT(*)::int AS n FROM "fulfillment_work_verifications" WHERE "fulfillmentWorkId" = $1 AND "voidedAt" IS NULL`,
      [work.id]
    )) as { n: number }[];
    expect(ledger[0].n).toBe(2);
  });

  it('records ONE physical gesture once, however many times it arrives', async () => {
    const http = harness.getHttp();
    const work = await seedParcel(3);
    const token = await loginAsPacker(http, harness.getDataSource());
    const lineId = (
      await http
        .get(`/v1/bench/work/${work.id}/parcel`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
    ).body.lines[0].workLineId as string;

    await http
      .post(`/v1/bench/work/${work.id}/verifications`)
      .set('Authorization', `Bearer ${token}`)
      .send({ workLineId: lineId, gestureId: 'one-action' })
      .expect(201);

    const replay = await http
      .post(`/v1/bench/work/${work.id}/verifications`)
      .set('Authorization', `Bearer ${token}`)
      .send({ workLineId: lineId, gestureId: 'one-action' })
      .expect(201);

    expect(replay.body.outcome).toBe('deduplicated');
    expect(replay.body.parcel.lines[0].verifiedQuantity).toBe(1);

    // …and a genuinely SECOND unit carries a different id and counts (G3).
    const genuine = await http
      .post(`/v1/bench/work/${work.id}/verifications`)
      .set('Authorization', `Bearer ${token}`)
      .send({ workLineId: lineId, gestureId: 'another-action' })
      .expect(201);
    expect(genuine.body.parcel.lines[0].verifiedQuantity).toBe(2);
  });

  it('reopens a closed parcel, voiding its ledger with who and when (E6)', async () => {
    const http = harness.getHttp();
    const work = await seedParcel(1);
    const token = await loginAsPacker(http, harness.getDataSource());
    const lineId = (
      await http
        .get(`/v1/bench/work/${work.id}/parcel`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
    ).body.lines[0].workLineId as string;

    await http
      .post(`/v1/bench/work/${work.id}/verifications`)
      .set('Authorization', `Bearer ${token}`)
      .send({ workLineId: lineId, gestureId: 'g-close' })
      .expect(201);

    const reopened = await http
      .post(`/v1/bench/work/${work.id}/reopen`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(201);

    expect(reopened.body.outcome).toBe('reopened');
    expect(reopened.body.parcel.closedAt).toBeNull();
    expect(reopened.body.parcel.lines[0].verifiedQuantity).toBe(0);

    // Voided, never deleted: these two columns ARE the reopen audit, which is
    // why no `lastReopenedAt` column exists on the work.
    const rows = (await harness
      .getDataSource()
      .query(
        `SELECT "voidedAt", "voidedByUserId" FROM "fulfillment_work_verifications" WHERE "fulfillmentWorkId" = $1`,
        [work.id]
      )) as { voidedAt: Date | null; voidedByUserId: string | null }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].voidedAt).not.toBeNull();
    expect(rows[0].voidedByUserId).not.toBeNull();

    // And verification resumes — the whole point of E6.
    const again = await http
      .post(`/v1/bench/work/${work.id}/verifications`)
      .set('Authorization', `Bearer ${token}`)
      .send({ workLineId: lineId, gestureId: 'g-after-reopen' })
      .expect(201);
    expect(again.body.outcome).toBe('verified');
    expect(again.body.parcel.closedAt).not.toBeNull();
  });

  it('returns a token the very next reopen can use (the post-close version)', async () => {
    // The close bumps `version` in SQL. If the response carried the version
    // read BEFORE the write, the reopen this packer is about to make — the only
    // correction path the surface has, reached in the seconds after a mis-scan
    // shut the box — would be refused as `not-closed` about a parcel the same
    // screen is rendering as closed, until an unrelated poll healed it.
    //
    // Nothing else in the suite can fail on this: the reopen case below sends
    // no token at all, and the unit spec asserts only that one is forwarded.
    const http = harness.getHttp();
    const work = await seedParcel(1);
    const token = await loginAsPacker(http, harness.getDataSource());
    const opened = (
      await http
        .get(`/v1/bench/work/${work.id}/parcel`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
    ).body as ParcelBody;

    const closed = await http
      .post(`/v1/bench/work/${work.id}/verifications`)
      .set('Authorization', `Bearer ${token}`)
      .send({ workLineId: opened.lines[0].workLineId, gestureId: 'g-token' })
      .expect(201);

    expect(closed.body.parcel.closedAt).not.toBeNull();
    // The token MOVED — otherwise this test would pass against the defect.
    expect(closed.body.parcel.version).toBeGreaterThan(opened.version);

    const reopened = await http
      .post(`/v1/bench/work/${work.id}/reopen`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedVersion: closed.body.parcel.version as number })
      .expect(201);

    expect(reopened.body.outcome).toBe('reopened');
    // And the reopen's own answer is usable in turn.
    expect(reopened.body.parcel.version).toBeGreaterThan(closed.body.parcel.version as number);
  });

  it('refuses a reopen against a genuinely stale token, writing nothing', async () => {
    const http = harness.getHttp();
    const work = await seedParcel(1);
    const token = await loginAsPacker(http, harness.getDataSource());
    const opened = (
      await http
        .get(`/v1/bench/work/${work.id}/parcel`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
    ).body as ParcelBody;

    await http
      .post(`/v1/bench/work/${work.id}/verifications`)
      .set('Authorization', `Bearer ${token}`)
      .send({ workLineId: opened.lines[0].workLineId, gestureId: 'g-stale' })
      .expect(201);

    // The version the packer held BEFORE the box closed — D21's scenario.
    const refused = await http
      .post(`/v1/bench/work/${work.id}/reopen`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedVersion: opened.version })
      .expect(201);

    expect(refused.body.outcome).toBe('refused');
    expect(refused.body.parcel.closedAt).not.toBeNull();
  });

  it('reports a parcel that is not this bench’s as 404, not as a refusal', async () => {
    const http = harness.getHttp();
    const token = await loginAsPacker(http, harness.getDataSource());

    // "Does not exist" and "is not yours" answer the same 404 on purpose:
    // distinguishing them would let a packer enumerate which work ids exist.
    await http
      .get('/v1/bench/work/ol_fulfillmentwork_nope/parcel')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('serves the parcel’s documents without opening the invoicing register', async () => {
    const http = harness.getHttp();
    const work = await seedParcel();
    const token = await loginAsPacker(http, harness.getDataSource());

    const res = await http
      .get(`/v1/bench/work/${work.id}/documents`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // No invoice was issued for this order, which is a NAMED state rather than
    // an error — and it does not stop the box being packed (D17).
    expect(res.body.invoice.state).toBe('missing');
    expect(res.body.label.state).toBe('none');

    // The unlabelled list is readable by the same session, and by dispatch.
    const unlabelled = await http
      .get('/v1/bench/unlabelled-parcels')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(Array.isArray(unlabelled.body.parcels)).toBe(true);
  });

  it('STILL refuses a packer /orders and the invoicing register', async () => {
    // The two routes above are the replacements for exactly these. A
    // replacement that quietly reopened what it replaced would be worse than
    // not having built it, so both halves are asserted in one place.
    const http = harness.getHttp();
    const token = await loginAsPacker(http, harness.getDataSource());

    await http.get('/v1/orders').set('Authorization', `Bearer ${token}`).expect(403);
    await http
      .get('/v1/orders/ol_order_bench_parcel')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    await http.get('/v1/invoices').set('Authorization', `Bearer ${token}`).expect(403);
    await http
      .get('/v1/invoices/ol_invoice_nope/document')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('refuses an anonymous request to every parcel route', async () => {
    const http = harness.getHttp();
    await http.get('/v1/bench/work/ol_x/parcel').expect(401);
    await http.post('/v1/bench/work/ol_x/verifications').send({}).expect(401);
    await http.post('/v1/bench/work/ol_x/reopen').send({}).expect(401);
    await http.get('/v1/bench/unlabelled-parcels').expect(401);
  });
});
