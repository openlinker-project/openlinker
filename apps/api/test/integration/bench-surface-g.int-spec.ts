/**
 * Surface G, across the seam (#2420, `W3b-7`, spec § 2.7)
 *
 * G1, G2 and G3 were each built by a different issue — #2413, #2413 and
 * #2416/#2418 — and each was asserted in isolation. This file asserts what only
 * a real Postgres and the real services together can show, and it is deliberate
 * about which claims it can make and which it cannot.
 *
 * ## Two acceptance criteria of #2420 cannot be met against the shipped model
 *
 * Written here rather than only in the report, because a reader of these tests
 * must not infer from their passing that the criteria were met.
 *
 * **AC-2 asks that "neither and both" be unrepresentable for the packed actor.**
 * Only *both* is. `CHK_fulfillment_works_packed_actor` is
 * `NOT (a IS NOT NULL AND b IS NOT NULL)` — at-most-one, and #2413's migration
 * docblock explains why a true XOR is impossible: a work is created unpacked, so
 * `<>` would be unsatisfiable at INSERT and would fail on every existing row.
 * That much is a recorded, correct decision.
 *
 * What has changed since is the disambiguator. #2413 argued both-NULL is safe
 * because *"`status` distinguishes them"*. #2418 then added `parcelClosedAt`, and
 * with it the state `parcelClosedAt IS NOT NULL AND both actors NULL` — which
 * `status` does not disambiguate, and which says exactly the dangerous thing G1
 * exists to prevent: *this parcel was packed and we do not know by whom*. It is
 * reachable: `VerifyUnitInput.verifiedByUserId` is `string | null`,
 * `claimParcelClose` writes it through, and the controller passes
 * `user?.id ?? null` from an OPTIONAL `@CurrentUser()`. Only `RolesGuard` on that
 * route guarantees a principal. So the route guard, not the model, is what
 * upholds G1 — which is what the first test below actually asserts, and it says
 * so.
 *
 * **AC-3 asks for exactly one order-grain packed fact on a split order.** No
 * order-grain fact is produced by packing at all: `markPacked` has one production
 * caller, the #2287 manual toggle on `/orders`, and closing a parcel writes
 * `fulfillment_works` alone. So the order-grain half is NOT asserted here.
 * Calling `markPacked` twice beside a split fixture would pass with both work
 * rows deleted — it is true of any order, says nothing about splitting, and
 * duplicates `order-record-packed.service.spec.ts`. What IS asserted is the
 * per-work grain, which is real, reachable, and asserted nowhere else.
 *
 * Neither gap is pinned as correct by any test here. A test asserting the
 * absence would entrench it.
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

  // Deliberately NOT "G1 — who packed it is always answerable": it is not,
  // and a green line saying so is how AC-2 gets ticked against a model that
  // does not hold it. See this file's header.
  describe('G1 — who packed it, as far as the shipped route guarantees', () => {
    it('records the packer’s own id and no service, through the real route', async () => {
      // The shipped path, end to end: the attribution is the VERIFIED TOKEN's
      // user, never anything the client sent. `RolesGuard` is what guarantees
      // there is one — see this file's header on AC-2.
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
