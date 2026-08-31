/**
 * `RoutingCommitService` (#2395, `W3a-6`, ADR-054 R1)
 *
 * The #2047 four-part gate. Two routers producing two plans for one order is a
 * double shipment, so most of what is asserted here is what does NOT happen.
 *
 * The load-bearing test in this file is
 * *"should leave the decision live when the router times out"*. The instinct
 * when reading that path is to free the order; doing so reopens the double-ship,
 * because `abandoned` leaves the live partial-unique index and the next attempt
 * mints a NEW decision id and therefore a NEW idempotency key the vendor cannot
 * dedup against a call that may still be committing.
 *
 * @module libs/core/src/fulfillment/application/services/__tests__
 */
import { RoutingDecision } from '../../../domain/entities/routing-decision.entity';
import { RoutingDecisionAlreadyLiveError } from '../../../domain/exceptions/routing-decision-already-live.error';
import { RoutingDecisionNoLongerLiveError } from '../../../domain/exceptions/routing-decision-no-longer-live.error';
import type { FulfillmentRouterPort } from '../../../domain/ports/fulfillment-router.port';
import type { RoutingLockPort } from '../../../domain/ports/routing-lock.port';
import type { RoutingPlan, RoutingShipTo } from '../../../index';
import {
  FULFILLMENT_ROUTE_LOCK_TTL_MS,
  FULFILLMENT_ROUTE_TIMEOUT_MS,
  fulfillmentRouteLockKey,
} from '../routing-commit-lock';
import { RoutingCommitService } from '../routing-commit.service';

const ORDER = 'ol_order_1';
const ROUTER_CONN = 'conn_router';

const decision = (overrides: Partial<RoutingDecision> = {}): RoutingDecision =>
  new RoutingDecision(
    (overrides.id as string) ?? 'ol_routingdecision_1',
    overrides.orderId ?? ORDER,
    overrides.routerConnectionId ?? ROUTER_CONN,
    overrides.state ?? 'live',
    overrides.routerDecisionRef ?? null,
    overrides.abandonReason ?? null,
    overrides.terminalisedAt ?? null,
    overrides.createdAt ?? new Date(),
    overrides.updatedAt ?? new Date()
  );

const shipTo: RoutingShipTo = { mode: 'plain', countryIso2: 'PL', postalCode: '00-001', city: 'W' };

const resolvedPlan = (overrides: Partial<Extract<RoutingPlan, { status: 'resolved' }>> = {}) => ({
  status: 'resolved' as const,
  decisionId: 'vendor-1',
  assignments: overrides.assignments ?? [
    {
      orderLineId: 'l1',
      locationId: 'loc-1',
      connectionId: 'c1',
      deliveryMethod: null,
      quantity: 2,
    },
  ],
  unfulfillable: overrides.unfulfillable ?? [],
  holds: overrides.holds ?? [],
  explanation: [],
});

describe('RoutingCommitService', () => {
  let decisions: {
    claimIntent: jest.Mock;
    terminalise: jest.Mock;
    findLiveByOrderId: jest.Mock;
    findById: jest.Mock;
  };
  let works: { create: jest.Mock; findByOrderId: jest.Mock; runInTransaction: jest.Mock };
  let lock: jest.Mocked<RoutingLockPort>;
  let router: jest.Mocked<FulfillmentRouterPort>;
  let service: RoutingCommitService;

  const input = (overrides: Record<string, unknown> = {}) => ({
    orderId: ORDER,
    routerConnectionId: ROUTER_CONN,
    lines: [{ orderLineId: 'l1', productVariantId: 'ol_variant_1', quantity: 2 }],
    shipTo,
    requestedDeliveryMethod: null,
    router,
    lock,
    isCancelled: () => Promise.resolve(false),
    ...overrides,
  });

  beforeEach(() => {
    decisions = {
      claimIntent: jest.fn().mockResolvedValue(decision()),
      terminalise: jest.fn().mockResolvedValue(true),
      findLiveByOrderId: jest.fn().mockResolvedValue(null),
      findById: jest.fn(),
    };
    works = {
      create: jest.fn().mockResolvedValue({ id: 'ol_work_1' }),
      findByOrderId: jest.fn().mockResolvedValue([]),
      // Runs `fn` for real so the commit body is genuinely exercised; the
      // rollback property itself is pinned by the int-spec, which needs a real
      // database to mean anything.
      runInTransaction: jest.fn(async (fn: (t: unknown) => Promise<unknown>) =>
        fn({ save: jest.fn() })
      ),
    };
    lock = {
      acquire: jest.fn().mockResolvedValue('token'),
      release: jest.fn().mockResolvedValue(true),
    };
    router = { route: jest.fn().mockResolvedValue(resolvedPlan()), evaluate: jest.fn() };

    service = new RoutingCommitService(decisions as never, works as never);
  });

  describe('the declared timeout', () => {
    it('should be strictly below the lock TTL', () => {
      // Not decoration: a router still running after the lock expired can have
      // its work committed concurrently with a peer that has since acquired it.
      expect(FULFILLMENT_ROUTE_TIMEOUT_MS).toBeLessThan(FULFILLMENT_ROUTE_LOCK_TTL_MS);
      expect(FULFILLMENT_ROUTE_TIMEOUT_MS).toBeGreaterThan(0);
    });
  });

  describe('the lock', () => {
    it('should be keyed per ORDER, never per (order, router)', () => {
      // Two operators configuring two different routers for one order is exactly
      // the case a per-connection key would let through.
      expect(fulfillmentRouteLockKey(ORDER)).toBe(`fulfillment:route:${ORDER}`);
      expect(fulfillmentRouteLockKey(ORDER)).not.toContain(ROUTER_CONN);
    });

    it('should answer from persisted state and NEVER call the router when contended', async () => {
      lock.acquire.mockResolvedValue(null);

      const outcome = await service.route(input());

      expect(outcome).toEqual({ status: 'contended' });
      // The whole point of the branch.
      expect(router.route).not.toHaveBeenCalled();
      expect(decisions.claimIntent).not.toHaveBeenCalled();
      expect(works.create).not.toHaveBeenCalled();
    });

    it('should release the lock even when the commit throws', async () => {
      works.runInTransaction.mockRejectedValue(new Error('db down'));

      await expect(service.route(input())).rejects.toThrow('db down');
      expect(lock.release).toHaveBeenCalledWith(fulfillmentRouteLockKey(ORDER), 'token');
    });

    it('should not let a release failure mask the outcome', async () => {
      lock.release.mockRejectedValue(new Error('redis blip'));

      const outcome = await service.route(input());

      expect(outcome.status).toBe('routed');
    });
  });

  describe('the write-path guard', () => {
    it('should skip when the order already carries non-cancelled work', async () => {
      works.findByOrderId.mockResolvedValue([{ cancelledAt: null }]);

      const outcome = await service.route(input());

      expect(outcome).toEqual({ status: 'skipped', reason: 'already-routed' });
      expect(router.route).not.toHaveBeenCalled();
    });

    it('should NOT be blocked by cancelled work — that is the re-route path', async () => {
      works.findByOrderId.mockResolvedValue([{ cancelledAt: new Date() }]);

      const outcome = await service.route(input());

      expect(outcome.status).toBe('routed');
    });

    it('should refuse a live decision held by a DIFFERENT router', async () => {
      // Router-agnostic by design: the guard refuses regardless of identity.
      decisions.findLiveByOrderId.mockResolvedValue(decision({ routerConnectionId: 'conn_other' }));

      const outcome = await service.route(input());

      expect(outcome).toEqual({ status: 'skipped', reason: 'already-live-elsewhere' });
      expect(router.route).not.toHaveBeenCalled();
    });

    it('should re-read cancellation INSIDE the lock', async () => {
      const isCancelled = jest.fn().mockResolvedValue(true);

      const outcome = await service.route(input({ isCancelled }));

      expect(outcome).toEqual({ status: 'skipped', reason: 'order-cancelled' });
      // Called after the lock was taken — a value read before it would be stale.
      expect(lock.acquire).toHaveBeenCalled();
      expect(isCancelled).toHaveBeenCalled();
      expect(router.route).not.toHaveBeenCalled();
    });
  });

  describe('resuming a crashed attempt', () => {
    it('should resume the live decision under the IDENTICAL idempotency key', async () => {
      // A crash between `claimIntent` and the commit leaves a live row. Without
      // resumption that row refuses every later attempt and the order is
      // stranded forever; with it, the retry re-derives the same key, which is
      // exactly what an idempotency key is for.
      decisions.findLiveByOrderId.mockResolvedValue(decision({ id: 'ol_routingdecision_9' }));

      const outcome = await service.route(input());

      expect(outcome.status).toBe('routed');
      expect(decisions.claimIntent).not.toHaveBeenCalled();
      expect(router.route).toHaveBeenCalledWith(expect.anything(), {
        idempotencyKey: 'route:ol_routingdecision_9',
      });
    });

    it('should resume when the INDEX refuses the insert after a clean guard read', async () => {
      // The guard read is a convenience; the partial-unique index is the
      // enforcement. A peer won the race between them.
      decisions.findLiveByOrderId
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(decision({ id: 'ol_routingdecision_7' }));
      decisions.claimIntent.mockRejectedValue(new RoutingDecisionAlreadyLiveError(ORDER));

      const outcome = await service.route(input());

      expect(outcome.status).toBe('routed');
      expect(router.route).toHaveBeenCalledWith(expect.anything(), {
        idempotencyKey: 'route:ol_routingdecision_7',
      });
    });
  });

  describe('in doubt', () => {
    it('should leave the decision LIVE when the router throws', async () => {
      router.route.mockRejectedValue(new Error('connection reset'));

      const outcome = await service.route(input());

      expect(outcome).toEqual({
        status: 'in-doubt',
        decisionId: 'ol_routingdecision_1',
        cause: 'error',
      });
      // THE assertion of this file. Terminalising here would take the row out of
      // the live index, so a re-route would mint a new key the vendor cannot
      // dedup against a call that may still be committing — two shipments.
      expect(decisions.terminalise).not.toHaveBeenCalled();
      expect(works.create).not.toHaveBeenCalled();
    });

    it('should leave the decision LIVE when the router exceeds its budget', async () => {
      jest.useFakeTimers();
      router.route.mockImplementation(() => new Promise(() => undefined));

      const pending = service.route(input());
      await jest.advanceTimersByTimeAsync(FULFILLMENT_ROUTE_TIMEOUT_MS + 1);
      const outcome = await pending;

      expect(outcome).toEqual({
        status: 'in-doubt',
        decisionId: 'ol_routingdecision_1',
        cause: 'timeout',
      });
      expect(decisions.terminalise).not.toHaveBeenCalled();
      jest.useRealTimers();
    });

    it('should not raise an unhandled rejection when the router rejects AFTER the timeout', async () => {
      // `Promise.race` does not cancel the loser, so the router promise outlives
      // the budget. With nothing attached, a late rejection is an unhandled
      // rejection — which on a worker configured to exit on one would take the
      // process down for a call we had already stopped waiting on.
      jest.useFakeTimers();
      let rejectLate: (error: Error) => void = () => undefined;
      router.route.mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            rejectLate = reject;
          })
      );
      const unhandled = jest.fn();
      process.on('unhandledRejection', unhandled);

      const pending = service.route(input());
      await jest.advanceTimersByTimeAsync(FULFILLMENT_ROUTE_TIMEOUT_MS + 1);
      const outcome = await pending;

      rejectLate(new Error('router died long after we stopped waiting'));
      jest.useRealTimers();
      // Let the microtask queue drain so an unhandled rejection would surface.
      await new Promise((resolve) => setImmediate(resolve));

      expect(outcome).toMatchObject({ status: 'in-doubt', cause: 'timeout' });
      expect(unhandled).not.toHaveBeenCalled();
      process.off('unhandledRejection', unhandled);
    });
  });

  describe('refusing a plan', () => {
    it('should abandon a non-conserving plan', async () => {
      router.route.mockResolvedValue(
        resolvedPlan({
          assignments: [
            {
              orderLineId: 'l1',
              locationId: null,
              connectionId: null,
              deliveryMethod: null,
              quantity: 1,
            },
          ],
        })
      );

      const outcome = await service.route(input());

      expect(outcome).toMatchObject({ status: 'refused', reason: 'plan-not-conserving' });
      expect(works.create).not.toHaveBeenCalled();
    });

    it('should refuse a plan carrying holds rather than dropping them', async () => {
      // Committing the plan MINUS its holds would silently drop quantities from
      // a plan that just passed the conservation check.
      router.route.mockResolvedValue(
        resolvedPlan({
          assignments: [
            {
              orderLineId: 'l1',
              locationId: 'loc-1',
              connectionId: 'c1',
              deliveryMethod: null,
              quantity: 1,
            },
          ],
          holds: [{ orderLineId: 'l1', quantity: 1, reason: 'awaiting_stock' as never }],
        })
      );

      const outcome = await service.route(input());

      expect(outcome).toMatchObject({ status: 'refused', reason: 'plan-carries-holds' });
      expect(works.create).not.toHaveBeenCalled();
    });

    it('should refuse a plan carrying unfulfillable lines', async () => {
      router.route.mockResolvedValue(
        resolvedPlan({
          assignments: [
            {
              orderLineId: 'l1',
              locationId: 'loc-1',
              connectionId: 'c1',
              deliveryMethod: null,
              quantity: 1,
            },
          ],
          unfulfillable: [
            { orderLineId: 'l1', quantity: 1, resolution: 'refund' as const, reason: 'oos' },
          ],
        })
      );

      const outcome = await service.route(input());

      expect(outcome).toMatchObject({ status: 'refused', reason: 'plan-carries-unfulfillable' });
    });

    it('should report contention rather than a refusal that was never persisted', async () => {
      // The handler's `refused` arm tells an operator the reason is durable on
      // the decision row. If a peer terminalised first, that sentence is false —
      // and a wrong reason is worse than none.
      router.route.mockResolvedValue(resolvedPlan({ assignments: [] }));
      decisions.terminalise.mockResolvedValue(false);

      const outcome = await service.route(input());

      expect(outcome).toEqual({ status: 'contended' });
    });

    it('should keep the vendor reference on an abandoned decision', async () => {
      router.route.mockResolvedValue(resolvedPlan({ assignments: [] }));

      await service.route(input());

      // The one value that lets an operator correlate the refusal against the
      // vendor's own log.
      expect(decisions.terminalise).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'abandoned', routerDecisionRef: 'vendor-1' })
      );
    });
  });

  describe('committing', () => {
    it('should create work and terminalise inside ONE transaction', async () => {
      // Capture the handle each write actually received, rather than indexing
      // into `mock.calls` (which is `any` and would defeat the point of
      // asserting they are the SAME object).
      const handles: unknown[] = [];
      works.create.mockImplementation((_input: unknown, transaction: unknown) => {
        handles.push(transaction);
        return Promise.resolve({ id: 'ol_work_1' });
      });
      decisions.terminalise.mockImplementation((arg: { transaction?: unknown }) => {
        handles.push(arg.transaction);
        return Promise.resolve(true);
      });

      const outcome = await service.route(input());

      expect(outcome).toMatchObject({ status: 'routed', workIds: ['ol_work_1'] });
      expect(works.runInTransaction).toHaveBeenCalledTimes(1);
      // Both writes received the SAME handle — this is ADR-054 R1.
      expect(handles).toHaveLength(2);
      expect(handles[0]).toBeDefined();
      expect(handles[1]).toBe(handles[0]);
    });

    it('should split work per (location, connection, deliveryMethod) and never split the order', async () => {
      router.route.mockResolvedValue(
        resolvedPlan({
          assignments: [
            {
              orderLineId: 'l1',
              locationId: 'loc-1',
              connectionId: 'c1',
              deliveryMethod: null,
              quantity: 1,
            },
            {
              orderLineId: 'l1',
              locationId: 'loc-2',
              connectionId: 'c1',
              deliveryMethod: null,
              quantity: 1,
            },
          ],
        })
      );
      works.create
        .mockResolvedValueOnce({ id: 'ol_work_a' })
        .mockResolvedValueOnce({ id: 'ol_work_b' });

      const outcome = await service.route(input());

      // ADR-054: splits exist ONLY at the work grain.
      expect(outcome).toMatchObject({ status: 'routed', workIds: ['ol_work_a', 'ol_work_b'] });
      expect(works.create).toHaveBeenCalledTimes(2);
    });

    it('should SUM two assignments that share a target and an order line', async () => {
      // The one branch that decides a written quantity, and the only one the
      // other multi-assignment tests do not reach (they differ by target).
      // Getting it wrong inserts the same `(work, orderLine)` twice, which
      // raises `DuplicateFulfillmentWorkLineError` and aborts the whole
      // transaction — so a silent regression here fails the entire commit.
      router.route.mockResolvedValue(
        resolvedPlan({
          assignments: [
            {
              orderLineId: 'l1',
              locationId: 'loc-1',
              connectionId: 'c1',
              deliveryMethod: null,
              quantity: 1,
            },
            {
              orderLineId: 'l1',
              locationId: 'loc-1',
              connectionId: 'c1',
              deliveryMethod: null,
              quantity: 1,
            },
          ],
        })
      );

      const outcome = await service.route(input());

      expect(outcome.status).toBe('routed');
      // ONE work object, ONE line, quantities added — never two lines.
      expect(works.create).toHaveBeenCalledTimes(1);
      expect(works.create).toHaveBeenCalledWith(
        expect.objectContaining({
          lines: [{ orderLineId: 'l1', productVariantId: 'ol_variant_1', totalQuantity: 2 }],
        }),
        expect.anything()
      );
    });

    it('should resolve the work line variant from the routing input, never a sentinel', async () => {
      await service.route(input());

      expect(works.create).toHaveBeenCalledWith(
        expect.objectContaining({
          lines: [{ orderLineId: 'l1', productVariantId: 'ol_variant_1', totalQuantity: 2 }],
        }),
        expect.anything()
      );
    });

    it('should roll back by throwing when the decision is no longer live', async () => {
      decisions.terminalise.mockResolvedValue(false);

      // A DISTINCT type from `RoutingDecisionAlreadyLiveError`, which asserts the
      // opposite condition and which `claimOrResume` matches on to mean "resume
      // the winner". Reusing it would give the next person who wraps this call
      // in a catch a resume where a rollback happened.
      await expect(service.route(input())).rejects.toBeInstanceOf(RoutingDecisionNoLongerLiveError);
    });

    it('should keep two targets apart when a delivery method contains the delimiter', async () => {
      // A `|`-joined key collides `(l='a', d='b|c')` with `(l='a|b', d='c')`, and
      // the collision does not produce a tidy duplicate — it merges two lines
      // bound for DIFFERENT LOCATIONS into one work object and ships from the
      // wrong place. `deliveryMethod` is the source's OPAQUE id, so a `|` is not
      // hypothetical.
      router.route.mockResolvedValue(
        resolvedPlan({
          assignments: [
            // Both render `a|b|c|d` under a `|`-joined template. All three
            // fields must be populated for the collision to exist — with a null
            // in either, the keys differ and the test would prove nothing.
            {
              orderLineId: 'l1',
              locationId: 'a',
              connectionId: 'b|c',
              deliveryMethod: 'd',
              quantity: 1,
            },
            {
              orderLineId: 'l1',
              locationId: 'a|b',
              connectionId: 'c',
              deliveryMethod: 'd',
              quantity: 1,
            },
          ],
        })
      );
      works.create
        .mockResolvedValueOnce({ id: 'ol_work_a' })
        .mockResolvedValueOnce({ id: 'ol_work_b' });

      const outcome = await service.route(input());

      expect(outcome).toMatchObject({ status: 'routed' });
      expect(works.create).toHaveBeenCalledTimes(2);
    });

    it('should distinguish a null target from an empty-string one', async () => {
      router.route.mockResolvedValue(
        resolvedPlan({
          assignments: [
            {
              orderLineId: 'l1',
              locationId: null,
              connectionId: null,
              deliveryMethod: null,
              quantity: 1,
            },
            {
              orderLineId: 'l1',
              locationId: '',
              connectionId: null,
              deliveryMethod: null,
              quantity: 1,
            },
          ],
        })
      );
      works.create
        .mockResolvedValueOnce({ id: 'ol_work_a' })
        .mockResolvedValueOnce({ id: 'ol_work_b' });

      await service.route(input());

      expect(works.create).toHaveBeenCalledTimes(2);
    });
  });
});
