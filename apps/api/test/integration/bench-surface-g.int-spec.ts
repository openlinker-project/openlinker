/**
 * Surface G, across the seam (#2420, `W3b-7`, spec § 2.7)
 *
 * G1, G2 and G3 were each built by a different issue — #2413, #2413 and
 * #2416/#2418 — and each was asserted in isolation. This file asserts what only
 * a real Postgres and the real services together can show, and it is deliberate
 * about which claims it can make and which it cannot.
 *
 * ## Two gaps this file reported in #2420, and #2890 then closed
 *
 * The history is kept because the SHAPE of both defects is instructive, and
 * because a reader who remembers the old header must not think the criteria are
 * still unmet.
 *
 * **AC-2 — "neither and both" must be unrepresentable for the packed actor.**
 * `CHK_fulfillment_works_packed_actor` is at-most-one, so only *both* was. That
 * was a correct decision when #2413 took it: a work is created unpacked, so a
 * true XOR would be unsatisfiable at INSERT, and both-NULL was judged safe
 * because *"`status` distinguishes"* not-yet-packed from packed-unattributed.
 * #2418 then added `parcelClosedAt` and quietly retired that argument — closed
 * with neither actor became representable, and it says the one thing G1 exists
 * to prevent: *this parcel was packed and we do not know by whom*. It was
 * reachable rather than theoretical, the bench route sourcing its actor from an
 * OPTIONAL `@CurrentUser()` with nothing but `RolesGuard` in the way.
 * **#2890 closed it at both ends**: `CHK_fulfillment_works_closed_parcel_actor`
 * makes the state unrepresentable, and `BenchVerifyUnitInput.verifiedByUserId`
 * is a non-nullable `string` so the route cannot attempt it — a constraint that
 * merely turned a live route into a 500 would not have been a fix. The two
 * constraints together are G1's *"exactly one"*, scoped to closure.
 *
 * **AC-3 — exactly one order-grain packed fact on a split order.** #2420 found
 * that packing produced NO order-grain fact at all (`markPacked`'s only caller
 * was #2287's manual toggle) and DROPPED its test rather than write one that
 * passes: calling `markPacked` twice beside a split fixture would have passed
 * with both work rows deleted — a check that cannot fail. **#2890 wired the
 * derivation**, so the assertion is restored below, driven through the HTTP
 * route by two different packers, which is the only version of it that can fail
 * for the right reason.
 *
 * The rule that produced the deletion still stands: an absence is never pinned
 * as correct here, because a test asserting one entrenches it.
 *
 * ## A note on `D4`
 *
 * "D4" below is the DECISIONS-table D4 — *"attribution grain is per work, per
 * phase; the order-grain fact is derived"*. It is not § 2.4's story D4, the
 * interrupt, which the bench code uses that name for elsewhere.
 *
 * @module apps/api/test/integration
 */
import {
  FULFILLMENT_VERIFICATION_SERVICE_TOKEN,
  FULFILLMENT_WORK_REPOSITORY_TOKEN,
  FULFILLMENT_WORKLIST_SERVICE_TOKEN,
  type CreateFulfillmentWorkInput,
  type FulfillmentWork,
  type IFulfillmentVerificationService,
  type IFulfillmentWorklistService,
} from '@openlinker/core/fulfillment';
import { OMS_PLATFORM_TYPE } from '@openlinker/oms';

import { getTestHarness, resetTestHarness, teardownTestHarness } from './setup';
import type { IntegrationTestHarness } from './setup';
import { loginAsPacker } from './helpers/test-auth.helper';
import { createTestConnection } from './helpers/test-connection.helper';
import { createTestOrderRecord } from './fixtures/order.fixtures';

/** The repository port is off the barrel; see `bench-work.int-spec.ts`. */
interface WorkFactoryView {
  create(input: CreateFulfillmentWorkInput): Promise<FulfillmentWork>;
}

interface PackedActorRow {
  parcelClosedAt: Date | null;
  packedByUserId: string | null;
  packedByService: string | null;
  version: string | number;
}

const ORDER_ID = 'ol_order_bench_surface_g';

describe('Surface G across the seam (#2420)', () => {
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
   * ONE packing executor, N accepted works, ONE order.
   *
   * `bench-parcel.int-spec.ts`'s `seedParcel` cannot serve this: it is a
   * `describe`-scoped closure that mints a fresh connection per call and
   * hardcodes its own order id, so calling it twice yields two works under two
   * DIFFERENT executors — which is not a split order, it is two benches.
   */
  async function seedSplitOrder(parcels: number, quantityPerParcel = 1): Promise<FulfillmentWork[]> {
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
    const created: FulfillmentWork[] = [];
    for (let index = 0; index < parcels; index += 1) {
      const work = await works.create({
        orderId: ORDER_ID,
        locationId: 'ol_location_1',
        deliveryMethod: 'courier',
        assignedConnectionId: oms.id,
        lines: [
          {
            orderLineId: `l-${String(index)}`,
            productVariantId: 'ol_variant_1',
            totalQuantity: quantityPerParcel,
          },
        ],
      });
      await dataSource.query(
        `UPDATE "fulfillment_works" SET "requestStatus" = 'accepted' WHERE "id" = $1`,
        [work.id]
      );
      created.push(work);
    }
    return created;
  }

  async function readActor(workId: string): Promise<PackedActorRow> {
    const rows = (await harness
      .getDataSource()
      .query(
        `SELECT "parcelClosedAt", "packedByUserId", "packedByService", "version"
           FROM "fulfillment_works" WHERE "id" = $1`,
        [workId]
      )) as PackedActorRow[];
    expect(rows).toHaveLength(1);
    return rows[0];
  }

  function verification(): IFulfillmentVerificationService {
    return harness
      .getApp()
      .get<IFulfillmentVerificationService>(FULFILLMENT_VERIFICATION_SERVICE_TOKEN);
  }

  // #2420 named this `who packed it, as far as the shipped route guarantees`,
  // because at the time only the route guard upheld G1 and a green line
  // claiming more would have ticked AC-2 against a model that did not hold it.
  // #2890 made the model hold it, so the understatement is retired.
  describe('G1 — who packed it is always answerable', () => {
    it('records the packer’s own id and no service, through the real route', async () => {
      // The shipped path, end to end: the attribution is the VERIFIED TOKEN's
      // user, never anything the client sent.
      const http = harness.getHttp();
      const [work] = await seedSplitOrder(1, 1);
      const token = await loginAsPacker(http, harness.getDataSource());

      const parcel = await http
        .get(`/v1/bench/work/${work.id}/parcel`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const lineId = (parcel.body as { lines: { workLineId: string }[] }).lines[0].workLineId;

      await http
        .post(`/v1/bench/work/${work.id}/verifications`)
        .set('Authorization', `Bearer ${token}`)
        .send({ workLineId: lineId, gestureId: 'g-1' })
        .expect(201);

      const row = await readActor(work.id);
      expect(row.parcelClosedAt).not.toBeNull();
      expect(row.packedByUserId).not.toBeNull();
      // A human packed it, so the service column stays empty. The two can never
      // both be set — that half of G1 the DB really does enforce.
      expect(row.packedByService).toBeNull();
    });

    it('refuses a CLOSED parcel that names NEITHER a human nor a service', async () => {
      // The other half of G1's "exactly one" (#2890 F1). Seeded by raw SQL
      // rather than produced, because the route can no longer attempt it —
      // which is the point: this asserts the MODEL forbids it, independently of
      // the type that stops the shipped caller reaching for it.
      const [work] = await seedSplitOrder(1, 1);

      await expect(
        harness
          .getDataSource()
          .query(`UPDATE "fulfillment_works" SET "parcelClosedAt" = now() WHERE "id" = $1`, [
            work.id,
          ])
      ).rejects.toThrow(/CHK_fulfillment_works_closed_parcel_actor/);
    });

    it('admits an OPEN work with no actor, which is the normal state', async () => {
      // The constraint above must be conditional on CLOSURE, never a bare XOR:
      // a work is created unpacked and spends most of its life that way, so an
      // unconditional rule would refuse every INSERT the router makes. Without
      // this line, tightening the predicate to `<>` would leave the test above
      // green while breaking routing.
      const [work] = await seedSplitOrder(1, 1);
      const row = await readActor(work.id);
      expect(row.parcelClosedAt).toBeNull();
      expect(row.packedByUserId).toBeNull();
      expect(row.packedByService).toBeNull();
    });

    it('refuses a row claiming BOTH a human and a service', async () => {
      const [work] = await seedSplitOrder(1, 1);

      await expect(
        harness
          .getDataSource()
          .query(
            `UPDATE "fulfillment_works"
                SET "packedByUserId" = '11111111-1111-1111-1111-111111111111',
                    "packedByService" = 'some-3pl'
              WHERE "id" = $1`,
            [work.id]
          )
      ).rejects.toThrow(/CHK_fulfillment_works_packed_actor/);
    });

    it('clears BOTH actor columns on a reopen, never just the one the bench wrote', async () => {
      // The bench close writes `packedByUserId` and never touches
      // `packedByService`, so a reopen that cleared only what the bench writes
      // would leave a stale SERVICE attribution on a parcel a human is about to
      // repack — and the at-most-one CHECK would then refuse that human's own
      // close, stranding the parcel.
      //
      // `packedByService` is therefore SEEDED here rather than produced: no code
      // path in the tree writes it yet (the column exists for a non-bench packer
      // that does not exist), so a test that merely closed through the bench
      // would assert `toBeNull()` against a column that was already null — an
      // assertion that cannot fail, which is worse than none. Verified by
      // mutation: deleting `packedByService: null` from `reopenParcel` leaves
      // the bench-only version of this test green and this one red.
      const [work] = await seedSplitOrder(1, 1);
      const service = verification();
      const state = await service.getState(work.id);

      await service.verifyUnit({
        workId: work.id,
        workLineId: state.lines[0].workLineId,
        gestureId: 'g-1',
        verifiedByUserId: '22222222-2222-2222-2222-222222222222',
      });
      expect((await readActor(work.id)).packedByUserId).not.toBeNull();

      // Swap the human for a service in one statement — the CHECK forbids the
      // intermediate state where both are set.
      await harness
        .getDataSource()
        .query(
          `UPDATE "fulfillment_works"
              SET "packedByUserId" = NULL, "packedByService" = 'some-3pl'
            WHERE "id" = $1`,
          [work.id]
        );
      expect((await readActor(work.id)).packedByService).toBe('some-3pl');

      await service.reopenParcel({
        workId: work.id,
        reopenedByUserId: '22222222-2222-2222-2222-222222222222',
        hasShipped: false,
      });

      const row = await readActor(work.id);
      expect(row.parcelClosedAt).toBeNull();
      expect(row.packedByUserId).toBeNull();
      expect(row.packedByService).toBeNull();
    });
  });

  describe('G2 — a split order attributes each parcel to its own packer', () => {
    it('keeps two packers on two works of ONE order, neither overwriting the other', async () => {
      // Decisions-table D4: *"an order can split into several works; an
      // order-grain person fact names one packer and drops the other."* This is
      // the case a single-parcel test cannot reach, and the reason the grain is
      // per work.
      const [first, second] = await seedSplitOrder(2, 1);
      const service = verification();

      const alice = '33333333-3333-3333-3333-333333333333';
      const bob = '44444444-4444-4444-4444-444444444444';

      const firstState = await service.getState(first.id);
      await service.verifyUnit({
        workId: first.id,
        workLineId: firstState.lines[0].workLineId,
        gestureId: 'g-first',
        verifiedByUserId: alice,
      });

      const secondState = await service.getState(second.id);
      await service.verifyUnit({
        workId: second.id,
        workLineId: secondState.lines[0].workLineId,
        gestureId: 'g-second',
        verifiedByUserId: bob,
      });

      const firstRow = await readActor(first.id);
      const secondRow = await readActor(second.id);

      expect(firstRow.packedByUserId).toBe(alice);
      expect(secondRow.packedByUserId).toBe(bob);
      expect(firstRow.parcelClosedAt).not.toBeNull();
      expect(secondRow.parcelClosedAt).not.toBeNull();

      // Both really are the same order — without this the test would pass on two
      // unrelated orders and would be asserting nothing about splitting.
      const rows = (await harness
        .getDataSource()
        .query(`SELECT DISTINCT "orderId" FROM "fulfillment_works" WHERE "id" = ANY($1)`, [
          [first.id, second.id],
        ])) as { orderId: string }[];
      expect(rows).toHaveLength(1);
      expect(rows[0].orderId).toBe(ORDER_ID);
    });

    it('closes the second parcel without disturbing the first parcel’s attribution', async () => {
      // The close is an at-most-once claim guarded `parcelClosedAt IS NULL`, so
      // a later sibling's close cannot rewrite an earlier one — the property
      // that makes per-work attribution durable rather than last-write-wins.
      const [first, second] = await seedSplitOrder(2, 1);
      const service = verification();
      const alice = '33333333-3333-3333-3333-333333333333';

      const firstState = await service.getState(first.id);
      await service.verifyUnit({
        workId: first.id,
        workLineId: firstState.lines[0].workLineId,
        gestureId: 'g-first',
        verifiedByUserId: alice,
      });
      const closedAt = (await readActor(first.id)).parcelClosedAt;

      const secondState = await service.getState(second.id);
      await service.verifyUnit({
        workId: second.id,
        workLineId: secondState.lines[0].workLineId,
        gestureId: 'g-second',
        verifiedByUserId: '44444444-4444-4444-4444-444444444444',
      });

      const firstRow = await readActor(first.id);
      expect(firstRow.packedByUserId).toBe(alice);
      expect(firstRow.parcelClosedAt).toEqual(closedAt);
    });
  });

  /**
   * G2's ORDER half — the assertion #2420 dropped, restored once #2890 wired it.
   *
   * Driven through the HTTP route by two DIFFERENT packers on a SPLIT order,
   * which is the only shape that can fail for the right reason. The version
   * #2420 declined — calling `markPacked` twice beside a split fixture — would
   * have passed with both work rows deleted, said nothing about splitting, and
   * duplicated `order-record-packed.service.spec.ts`.
   */
  describe('G2 — the order still has one answer', () => {
    /** The user id behind a seeded login, which the token does not carry back. */
    async function packerId(username: string): Promise<string> {
      const rows = (await harness
        .getDataSource()
        .query(`SELECT id FROM users WHERE username = $1`, [username])) as { id: string }[];
      expect(rows).toHaveLength(1);
      return rows[0].id;
    }

    /** Close one parcel through the real route, as `token`'s user. */
    async function packThroughRoute(workId: string, token: string, gestureId: string) {
      const http = harness.getHttp();
      const parcel = await http
        .get(`/v1/bench/work/${workId}/parcel`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const lineId = (parcel.body as { lines: { workLineId: string }[] }).lines[0].workLineId;

      await http
        .post(`/v1/bench/work/${workId}/verifications`)
        .set('Authorization', `Bearer ${token}`)
        .send({ workLineId: lineId, gestureId })
        .expect(201);
    }

    async function readOrderPacked(): Promise<{
      packedAt: Date | null;
      packedByUserId: string | null;
    }> {
      const rows = (await harness
        .getDataSource()
        .query(
          `SELECT "packedAt", "packedByUserId" FROM "order_records" WHERE "internalOrderId" = $1`,
          [ORDER_ID]
        )) as { packedAt: Date | null; packedByUserId: string | null }[];
      expect(rows).toHaveLength(1);
      return rows[0];
    }

    it('derives ONE order-grain fact from a split order, and it is the FIRST packer’s', async () => {
      // Decision D10: first writer wins. `markPacked`'s repository write is
      // `WHERE packedAt IS NULL`, so the second parcel's close affects no row —
      // the order names one packer and drops the other, which is precisely why
      // the detailed grain is per work.
      await createTestOrderRecord(harness.getDataSource(), { internalOrderId: ORDER_ID });
      const [first, second] = await seedSplitOrder(2, 1);
      const http = harness.getHttp();

      const aliceToken = await loginAsPacker(http, harness.getDataSource(), 'packer-alice');
      const bobToken = await loginAsPacker(http, harness.getDataSource(), 'packer-bob');
      const alice = await packerId('packer-alice');
      const bob = await packerId('packer-bob');
      expect(alice).not.toBe(bob);

      await packThroughRoute(first.id, aliceToken, 'g-first');
      const afterFirst = await readOrderPacked();
      expect(afterFirst.packedAt).not.toBeNull();
      expect(afterFirst.packedByUserId).toBe(alice);

      await packThroughRoute(second.id, bobToken, 'g-second');
      const afterSecond = await readOrderPacked();

      // ONE fact, unmoved. Both halves matter: `toBe(alice)` catches a write
      // that overwrote, and `toEqual(afterFirst.packedAt)` catches one that
      // rewrote the instant while keeping the id.
      expect(afterSecond.packedByUserId).toBe(alice);
      expect(afterSecond.packedAt).toEqual(afterFirst.packedAt);

      // And the per-work detail still names BOTH — the order-grain fact is a
      // derivation, never a replacement for it.
      expect((await readActor(first.id)).packedByUserId).toBe(alice);
      expect((await readActor(second.id)).packedByUserId).toBe(bob);
    });

    it('does not move the order fact when a parcel is reopened and repacked', async () => {
      // The same first-writer-wins guard, reached the other way. A reopen clears
      // the WORK's attribution but never `order_records.packedAt`, so the repack
      // finds the guard closed. This is also what stops the T5 `order.packed`
      // automation trigger firing a second time: `markPacked` emits only on the
      // transition its `WHERE packedAt IS NULL` performs.
      await createTestOrderRecord(harness.getDataSource(), { internalOrderId: ORDER_ID });
      const [work] = await seedSplitOrder(1, 1);
      const http = harness.getHttp();

      const aliceToken = await loginAsPacker(http, harness.getDataSource(), 'packer-alice');
      const bobToken = await loginAsPacker(http, harness.getDataSource(), 'packer-bob');
      const alice = await packerId('packer-alice');

      await packThroughRoute(work.id, aliceToken, 'g-first');
      const afterFirst = await readOrderPacked();

      await verification().reopenParcel({
        workId: work.id,
        reopenedByUserId: alice,
        hasShipped: false,
      });
      expect((await readActor(work.id)).packedByUserId).toBeNull();

      await packThroughRoute(work.id, bobToken, 'g-second');

      const afterRepack = await readOrderPacked();
      expect(afterRepack.packedByUserId).toBe(alice);
      expect(afterRepack.packedAt).toEqual(afterFirst.packedAt);
    });

    it('records the parcel even when the order it names was never ingested', async () => {
      // No `order_records` row at all — legitimate, since a work object carries
      // its order id by value. The order-grain write is best-effort precisely so
      // this cannot cost the packer a box they physically finished.
      const [work] = await seedSplitOrder(1, 1);
      const token = await loginAsPacker(harness.getHttp(), harness.getDataSource());

      await packThroughRoute(work.id, token, 'g-1');

      const row = await readActor(work.id);
      expect(row.parcelClosedAt).not.toBeNull();
      expect(row.packedByUserId).not.toBeNull();
    });
  });

  describe('G3 — a scan recorded once is recorded once', () => {
    it('counts two units of ONE line when two distinct gestures arrive', async () => {
      // The half that matters more often than the retry: a two-unit line is
      // ordinary, and dedup keyed on the LINE rather than the gesture would shut
      // the box one unit light while reading as perfectly verified.
      const [work] = await seedSplitOrder(1, 2);
      const service = verification();
      const lineId = (await service.getState(work.id)).lines[0].workLineId;

      const first = await service.verifyUnit({
        workId: work.id,
        workLineId: lineId,
        gestureId: 'gesture-a',
        verifiedByUserId: '55555555-5555-5555-5555-555555555555',
      });
      const second = await service.verifyUnit({
        workId: work.id,
        workLineId: lineId,
        gestureId: 'gesture-b',
        verifiedByUserId: '55555555-5555-5555-5555-555555555555',
      });

      expect(first.outcome).toBe('verified');
      expect(second.outcome).toBe('verified');
      expect(second.state.lines[0].verifiedQuantity).toBe(2);
    });

    it('counts one unit when the SAME gesture arrives twice', async () => {
      const [work] = await seedSplitOrder(1, 2);
      const service = verification();
      const lineId = (await service.getState(work.id)).lines[0].workLineId;

      const first = await service.verifyUnit({
        workId: work.id,
        workLineId: lineId,
        gestureId: 'gesture-retried',
        verifiedByUserId: '55555555-5555-5555-5555-555555555555',
      });
      const retry = await service.verifyUnit({
        workId: work.id,
        workLineId: lineId,
        gestureId: 'gesture-retried',
        verifiedByUserId: '55555555-5555-5555-5555-555555555555',
      });

      expect(first.outcome).toBe('verified');
      expect(retry.outcome).toBe('deduplicated');
      expect(retry.state.lines[0].verifiedQuantity).toBe(1);

      // Asserting both halves is the point: each alone is satisfiable by an
      // implementation that gets the other wrong. At the wire level these two
      // tests send the same request twice; only the gesture id separates them.
      const ledger = (await harness
        .getDataSource()
        .query(`SELECT COUNT(*)::int AS n FROM "fulfillment_work_verifications" WHERE
                  "fulfillmentWorkId" = $1`, [work.id])) as { n: number }[];
      expect(ledger[0].n).toBe(1);
    });
  });

  describe('G4 — packing does not spend the worklist’s optimistic token', () => {
    it('leaves `version` untouched by a scan that does not close the parcel', async () => {
      // The bench and the desktop worklist (#2406) hold the SAME token. If every
      // scan bumped it, a packer working through a five-unit parcel would
      // invalidate a planner's in-flight action four times over, and each
      // refusal would reach the operator as a stale-token conflict to resolve by
      // hand — exactly what G4 forbids. `verifyUnit` writes
      // `fulfillment_work_verifications`, a different table, so it does not.
      const [work] = await seedSplitOrder(1, 3);
      const service = verification();
      const lineId = (await service.getState(work.id)).lines[0].workLineId;
      const before = Number((await readActor(work.id)).version);

      await service.verifyUnit({
        workId: work.id,
        workLineId: lineId,
        gestureId: 'g-1',
        verifiedByUserId: '66666666-6666-6666-6666-666666666666',
      });

      expect(Number((await readActor(work.id)).version)).toBe(before);
    });

    it('lets the packer keep scanning after a planner moved the token underneath', async () => {
      // The direction a packer actually meets, and the one the two assertions
      // above do not cover: a planner expedites the parcel mid-pack, `version`
      // moves under the open bench surface, and the packer's next scan must
      // still land. If it did not, the operator-resolvable conflict G4 forbids
      // would arrive at the worst possible moment — mid-parcel, with the box
      // half full.
      //
      // It holds for a structural reason worth pinning rather than assuming:
      // `VerifyUnitInput` carries NO `expectedVersion`. A scan is guarded by
      // `lockWorkForVerification` and the ledger's unique index, never by the
      // optimistic token — only `reopenParcel` takes one. Adding
      // `expectedVersion` to `VerifyUnitInput` would break G4, and without this
      // test nothing would notice.
      const [work] = await seedSplitOrder(1, 2);
      const service = verification();
      const worklist = harness
        .getApp()
        .get<IFulfillmentWorklistService>(FULFILLMENT_WORKLIST_SERVICE_TOKEN);
      const lineId = (await service.getState(work.id)).lines[0].workLineId;

      const first = await service.verifyUnit({
        workId: work.id,
        workLineId: lineId,
        gestureId: 'g-before',
        verifiedByUserId: '77777777-7777-7777-7777-777777777777',
      });
      expect(first.outcome).toBe('verified');

      // The planning surface acts, on the token it legitimately holds.
      const beforePlanner = Number((await readActor(work.id)).version);
      await worklist.applyAction({
        workId: work.id,
        action: 'expedite',
        expectedVersion: beforePlanner,
      });
      expect(Number((await readActor(work.id)).version)).toBe(beforePlanner + 1);

      // The packer, holding the now-stale token, scans the second unit.
      const after = await service.verifyUnit({
        workId: work.id,
        workLineId: lineId,
        gestureId: 'g-after',
        verifiedByUserId: '77777777-7777-7777-7777-777777777777',
      });

      expect(after.outcome).toBe('verified');
      expect(after.state.lines[0].verifiedQuantity).toBe(2);
    });

    it('bumps `version` when the parcel closes, because that IS a state change', async () => {
      // The other direction, and equally load-bearing: a close that left the
      // token still would let a stale client's next write through against a
      // parcel that has already shut.
      const [work] = await seedSplitOrder(1, 1);
      const service = verification();
      const lineId = (await service.getState(work.id)).lines[0].workLineId;
      const before = Number((await readActor(work.id)).version);

      await service.verifyUnit({
        workId: work.id,
        workLineId: lineId,
        gestureId: 'g-1',
        verifiedByUserId: '66666666-6666-6666-6666-666666666666',
      });

      expect(Number((await readActor(work.id)).version)).toBe(before + 1);
    });
  });
});
