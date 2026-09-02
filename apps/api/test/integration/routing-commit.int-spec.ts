/**
 * Routing Commit integration test (#2395, `W3a-6`, ADR-054 R1, DESIGN §5.3)
 *
 * `RoutingCommitService` decides where an order is fulfilled from **exactly
 * once**. Two plans for one order is a double shipment: physical, and
 * unrecoverable. Every guarantee that prevents it is a DATABASE-level fact — a
 * transaction boundary, a partial-unique index, a persisted intent row — so
 * none of them can be observed against mocks. That is why these three tests are
 * integration tests rather than unit tests, and why every assertion below reads
 * the tables directly via `harness.getDataSource().query(...)` rather than
 * through a repository: the subject is what is actually persisted, not what a
 * mapper reports about it.
 *
 * `route()` takes `router`, `lock` and `isCancelled` as ARGUMENTS (the
 * zero-sibling-edge leaf's no-injection posture, ADR-053), so all three are
 * supplied here as fakes and no adapter wiring is needed.
 *
 * @module apps/api/test/integration
 */
import { randomUUID } from 'node:crypto';

import {
  ROUTING_COMMIT_SERVICE_TOKEN,
  ROUTING_DECISION_REPOSITORY_TOKEN,
} from '@openlinker/core/fulfillment';
import type {
  ClaimRoutingIntentInput,
  FulfillmentRouterPort,
  IRoutingCommitService,
  RouteOptions,
  RoutingDecision,
  RoutingEvaluation,
  RoutingInput,
  RoutingInputLine,
  RoutingLockPort,
  RoutingPlan,
  RoutingShipTo,
  TerminaliseRoutingDecisionInput,
} from '@openlinker/core/fulfillment';

import {
  getTestHarness,
  IntegrationTestHarness,
  resetTestHarness,
  teardownTestHarness,
} from './setup';

/**
 * A LOCAL structural view, not the port type — `RoutingDecisionRepositoryPort`
 * is intra-context and deliberately absent from the barrel (the deny pattern).
 * Mirrors `routing-decision-intent.int-spec.ts` and
 * `fulfillment-work-transitions.int-spec.ts`.
 */
interface RoutingDecisionRepositoryView {
  claimIntent(input: ClaimRoutingIntentInput): Promise<RoutingDecision>;
  terminalise(input: TerminaliseRoutingDecisionInput): Promise<boolean>;
  findLiveByOrderId(orderId: string): Promise<RoutingDecision | null>;
  findById(decisionId: string): Promise<RoutingDecision | null>;
}

/**
 * A real-ish in-memory lock: compare-and-set `acquire`, compare-and-delete
 * `release`, exactly the `SyncLockPort` contract `RoutingLockPort` describes
 * structurally. A stub that always granted the lock would make test 2 assert
 * nothing at all.
 *
 * `onAcquireAttempt` is the barrier seam test 2 needs — see there for why the
 * overlap has to be forced rather than hoped for.
 */
class InMemoryRoutingLock implements RoutingLockPort {
  private readonly held = new Map<string, string>();

  constructor(private readonly onAcquireAttempt?: () => Promise<void>) {}

  async acquire(key: string, _ttlMs: number): Promise<string | null> {
    if (this.onAcquireAttempt) {
      await this.onAcquireAttempt();
    }
    if (this.held.has(key)) {
      return null;
    }
    const token = randomUUID();
    this.held.set(key, token);
    return token;
  }

  async release(key: string, token: string): Promise<boolean> {
    if (this.held.get(key) !== token) {
      return false;
    }
    this.held.delete(key);
    return true;
  }
}

const SHIP_TO: RoutingShipTo = {
  mode: 'plain',
  countryIso2: 'PL',
  postalCode: '00-001',
  city: 'Warsaw',
};

const newOrderId = (): string => `ol_order_${randomUUID().replace(/-/g, '')}`;

describe('Routing commit (#2395)', () => {
  let harness: IntegrationTestHarness;
  let service: IRoutingCommitService;
  let decisions: RoutingDecisionRepositoryView;

  beforeAll(async () => {
    harness = await getTestHarness();
    service = harness.getApp().get<IRoutingCommitService>(ROUTING_COMMIT_SERVICE_TOKEN);
    decisions = harness
      .getApp()
      .get<RoutingDecisionRepositoryView>(ROUTING_DECISION_REPOSITORY_TOKEN);
  }, 180_000);

  afterEach(async () => {
    await resetTestHarness();
  });

  afterAll(async () => {
    await teardownTestHarness();
  });

  const countWorks = async (orderId: string): Promise<number> => {
    const rows = await harness
      .getDataSource()
      .query(`SELECT count(*)::int AS n FROM fulfillment_works WHERE "orderId" = $1`, [orderId]);
    return (rows as { n: number }[])[0].n;
  };

  const decisionRows = async (
    orderId: string,
  ): Promise<{ id: string; state: string }[]> =>
    (await harness
      .getDataSource()
      .query(`SELECT "id", "state" FROM routing_decisions WHERE "orderId" = $1`, [
        orderId,
      ])) as { id: string; state: string }[];

  /** A router fake that answers with a fixed plan and records what it was asked. */
  const routerReturning = (
    plan: RoutingPlan,
    hooks: { readonly beforeAnswer?: () => Promise<void> } = {},
  ): { port: FulfillmentRouterPort; calls: RouteOptions[] } => {
    const calls: RouteOptions[] = [];
    const port: FulfillmentRouterPort = {
      async evaluate(_input: RoutingInput): Promise<RoutingEvaluation> {
        throw new Error('evaluate() must never be reached from route()');
      },
      async route(_input: RoutingInput, options: RouteOptions): Promise<RoutingPlan> {
        calls.push(options);
        if (hooks.beforeAnswer) {
          await hooks.beforeAnswer();
        }
        return plan;
      },
    };
    return { port, calls };
  };

  const LINES: readonly RoutingInputLine[] = [
    { orderLineId: 'line-1', productVariantId: 'ol_variant_aaa', quantity: 5 },
  ];

  /**
   * TEST 1 — the one-transaction commit is atomic.
   *
   * ADR-054 R1: the N work rows and the decision's terminalisation commit
   * together, or neither does. The failure this guards against is a SPLIT
   * state — work row 1 persisted for a decision that never terminalised, or (in
   * the mirror case) a `committed` decision with only half its work — which is
   * an order that is partly routed with every surface reporting a clean result.
   *
   * The plan below is built so the SECOND work object cannot be written: two
   * assignments land in two distinct `(locationId, connectionId, deliveryMethod)`
   * buckets — the grain `groupAssignmentsIntoWork` splits on — and the second
   * carries a NEGATIVE quantity, which violates the real, named
   * `CHK_fulfillment_work_lines_capacity` constraint
   * (`"totalQuantity" >= 0 AND …`) declared on `fulfillment_work_lines`.
   *
   * The `7 + (-2) = 5` arithmetic is deliberate: `checkRoutingPlanConservesQuantities`
   * runs BEFORE the commit and refuses any plan that does not account for every
   * unit, so a plan that failed conservation would be refused before a single
   * row was written and this test would prove nothing about the transaction.
   * Conserving-but-unwritable is the only shape that reaches the boundary.
   *
   * **Verified red-first.** With `runInTransaction` temporarily reduced to
   * `return await fn(this.dataSource.manager)` — i.e. handing out the default
   * manager instead of opening a transaction — this test FAILS on the work-row
   * assertion, finding BOTH work headers persisted (`expect(received).toBe(expected)
   * … Expected: 0, Received: 2` — work 1 in full, and work 2's header surviving
   * its own rejected line, since `create` loses its inner transaction too). It passes only while the transaction is real,
   * which is what makes it a test of atomicity rather than of the constraint.
   */
  it('should persist NEITHER work row nor terminalise the decision when the second work fails', async () => {
    const orderId = newOrderId();
    const routerConnectionId = randomUUID();

    const { port: router } = routerReturning({
      status: 'resolved',
      decisionId: 'vendor-decision-atomic',
      assignments: [
        {
          orderLineId: 'line-1',
          locationId: 'loc-A',
          connectionId: null,
          deliveryMethod: null,
          quantity: 7,
        },
        {
          // Second bucket, second work object — and unwritable.
          orderLineId: 'line-1',
          locationId: 'loc-B',
          connectionId: null,
          deliveryMethod: null,
          quantity: -2,
        },
      ],
      unfulfillable: [],
      holds: [],
      explanation: [],
    });

    await expect(
      service.route({
        orderId,
        routerConnectionId,
        lines: LINES,
        shipTo: SHIP_TO,
        requestedDeliveryMethod: null,
        router,
        lock: new InMemoryRoutingLock(),
        isCancelled: async () => false,
      }),
    ).rejects.toBeDefined();

    // Work object 1 must NOT have survived its sibling's failure.
    expect(await countWorks(orderId)).toBe(0);

    // And the decision must still be LIVE — never `committed`, which would
    // claim an order that carries no work at all.
    const rows = await decisionRows(orderId);
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe('live');
  });

  /**
   * TEST 2 — two concurrent `route()` calls produce exactly ONE committed plan.
   *
   * A SEQUENTIAL version of this test passes against no guard whatsoever: the
   * first call terminalises its decision, the second finds committed work and
   * skips. So the two calls must genuinely OVERLAP, and overlap cannot be left
   * to the scheduler — `Promise.all` over two async functions does not by itself
   * guarantee that caller B has entered `route()` before caller A has left it.
   *
   * The barrier therefore sits in the lock fake's `acquire`, which is the FIRST
   * thing `route()` does: neither acquire returns until both have been
   * attempted, so both callers are provably inside `route()` at the same
   * instant, contending on the same key. One wins the lock; the other must
   * answer from persisted state and, critically, must never cross the router
   * boundary — a second router call under a second key is the double shipment.
   */
  it('should commit exactly one plan when two route() calls genuinely overlap', async () => {
    const orderId = newOrderId();
    const routerConnectionId = randomUUID();

    let entered = 0;
    let releaseBarrier: () => void;
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });
    const bothEntered = async (): Promise<void> => {
      entered += 1;
      if (entered >= 2) {
        releaseBarrier();
      }
      await barrier;
    };

    const lock = new InMemoryRoutingLock(bothEntered);
    const { port: router, calls } = routerReturning({
      status: 'resolved',
      decisionId: 'vendor-decision-concurrent',
      assignments: [
        {
          orderLineId: 'line-1',
          locationId: 'loc-A',
          connectionId: null,
          deliveryMethod: null,
          quantity: 5,
        },
      ],
      unfulfillable: [],
      holds: [],
      explanation: [],
    });

    const attempt = (): Promise<unknown> =>
      service.route({
        orderId,
        routerConnectionId,
        lines: LINES,
        shipTo: SHIP_TO,
        requestedDeliveryMethod: null,
        router,
        lock,
        isCancelled: async () => false,
      });

    const outcomes = await Promise.all([attempt(), attempt()]);

    // Exactly one decision, exactly one set of work — not two of either.
    const rows = await decisionRows(orderId);
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe('committed');
    expect(await countWorks(orderId)).toBe(1);

    // At most one committing key ever crossed the router boundary. This is the
    // assertion the whole barrier exists to make meaningful: a contended caller
    // that called the router would have minted a second plan, and the vendor
    // would have no way to dedup it.
    expect(calls.length).toBeLessThanOrEqual(1);

    const statuses = outcomes.map((o) => (o as { status: string }).status).sort();
    expect(statuses).toContain('routed');
    expect(statuses.filter((s) => s === 'routed')).toHaveLength(1);
  });

  /**
   * TEST 3 — a resumed attempt re-derives the IDENTICAL idempotency key.
   *
   * Simulates a crash between `claimIntent` and the commit: the intent row is
   * claimed directly and left `live`, exactly as a dead process would leave it.
   *
   * Resuming under the ORIGINAL key is what makes that crash recoverable. A
   * resume that minted a fresh decision id would mint a fresh key, which the
   * vendor cannot dedup against the first call — two plans, two shipments. This
   * is the #2039 `reconcileId` lesson stated at the level where it costs a
   * parcel: a retry that mints a new key is not a retry.
   */
  it('should resume a live decision under its original idempotency key', async () => {
    const orderId = newOrderId();
    const routerConnectionId = randomUUID();

    // The crash: intent persisted and committed, nothing after it.
    const stranded = await decisions.claimIntent({ orderId, routerConnectionId });

    const { port: router, calls } = routerReturning({
      status: 'resolved',
      decisionId: 'vendor-decision-resumed',
      assignments: [
        {
          orderLineId: 'line-1',
          locationId: 'loc-A',
          connectionId: null,
          deliveryMethod: null,
          quantity: 5,
        },
      ],
      unfulfillable: [],
      holds: [],
      explanation: [],
    });

    const outcome = await service.route({
      orderId,
      routerConnectionId,
      lines: LINES,
      shipTo: SHIP_TO,
      requestedDeliveryMethod: null,
      router,
      lock: new InMemoryRoutingLock(),
      isCancelled: async () => false,
    });

    expect(calls).toHaveLength(1);
    // Derived from the stranded row's own immutable id — byte-identical to the
    // key the crashed attempt would have used.
    expect(calls[0].idempotencyKey).toBe(`route:${stranded.id}`);

    // No SECOND decision row: the resume reused the stranded one rather than
    // claiming a fresh intent beside it.
    const rows = await decisionRows(orderId);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(stranded.id);
    expect(rows[0].state).toBe('committed');
    expect((outcome as { decisionId: string }).decisionId).toBe(stranded.id);
  });
});
