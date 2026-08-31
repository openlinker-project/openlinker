/**
 * Routing Commit Service (#2395, `W3a-6`, ADR-054 R1, DESIGN §5.3)
 *
 * Decides where an order is fulfilled from — **exactly once** — and commits the
 * decision and the work it creates atomically.
 *
 * Two routers producing two plans for one order is a **double shipment**:
 * physical, and unrecoverable. Every rule below exists for that one failure
 * mode, and this is a verbatim copy of the #2047 four-part invoicing shape,
 * where a wrong pick is a legal event rather than a parcel.
 *
 * ## The four parts, in the order they must happen
 *
 * 1. **Exactly one router.** Resolved upstream by `selectPrimaryFulfillmentRouter`;
 *    an ambiguous set never reaches here, because it commits nothing and is
 *    reported. Silence-and-pick-one is forbidden.
 * 2. **A per-ORDER lock**, `fulfillment:route:{orderId}`. Never per
 *    (order, router) — two operators configuring different routers for one order
 *    is exactly the case a per-connection key lets through.
 * 3. **A write-path guard that refuses regardless of router identity** — a live
 *    decision or any non-cancelled work for the order stops the commit.
 * 4. **Intent persisted BEFORE the boundary**, then N work rows plus the
 *    decision's terminalisation in ONE transaction.
 *
 * ## What actually enforces uniqueness
 *
 * Not the guard read. `routing_decisions` carries
 * `UNIQUE (orderId) WHERE state = 'live'`, and **that index is the enforcement**:
 * a `SELECT`-then-`INSERT` guarantees nothing at READ COMMITTED, because a plain
 * `SELECT` takes no locks and the conflicting row is a phantom. The guard read
 * exists to produce a clean, reportable outcome in the common case; the index is
 * what makes the invariant true. The lock narrows the window between them so the
 * common case stays common.
 *
 * ## One structural precondition of the atomic commit
 *
 * `commit()` hands ONE handle to both `FulfillmentWorkRepositoryPort.create` and
 * `RoutingDecisionRepositoryPort.terminalise`, and each narrows it to an
 * `EntityManager` internally. That is atomic only while both repositories share
 * one `DataSource` — true today, and silently false the day someone splits them,
 * at which point the two writes would commit independently with nothing
 * reporting it. Stated because it is invisible at this call site.
 *
 * ## The lock is not the guarantee either
 *
 * Note also that the router budget's clock starts at the ROUTER CALL, not at
 * `acquire`: four database round-trips (the cancellation re-read, the guard
 * reads and `claimIntent`) sit between them and are unbudgeted, so the real
 * margin is `TTL - budget - preamble`. That is a margin note rather than a hole
 * — a peer acquiring an expired lock finds the live row and resumes it under the
 * same key.
 *
 * A lock is lost on process death, on TTL expiry and on a Redis blip, and the
 * peer that acquires it next has no way to learn a `route()` is already in
 * flight. That is precisely why the intent row is persisted and COMMITTED before
 * the router is called — an ordering a lock cannot supply (REVIEW C2).
 *
 * @module libs/core/src/fulfillment/application/services
 * @see docs/architecture/adrs/054-fulfillment-work-unit-of-assignment.md
 */
import { Inject, Injectable } from '@nestjs/common';

import { Logger } from '@openlinker/shared/logging';

import { RoutingDecisionAlreadyLiveError } from '../../domain/exceptions/routing-decision-already-live.error';
import { RoutingDecisionNoLongerLiveError } from '../../domain/exceptions/routing-decision-no-longer-live.error';
import { PendingRoutingPlanNotSupportedError } from '../../domain/exceptions/pending-routing-plan-not-supported.error';
import { assertRoutingPlanResolved } from '../../domain/exceptions/pending-routing-plan-not-supported.error';
import { FulfillmentWorkRepositoryPort } from '../../domain/ports/fulfillment-work-repository.port';
import { RoutingDecisionRepositoryPort } from '../../domain/ports/routing-decision-repository.port';
import type { RoutingDecision } from '../../domain/entities/routing-decision.entity';
import {
  deriveRouteIdempotencyKey,
  type RoutingDecisionAbandonReason,
} from '../../domain/types/routing-decision.types';
import {
  checkRoutingPlanConservesQuantities,
  type ResolvedRoutingPlan,
  type RoutingInput,
} from '../../domain/types/routing.types';
import {
  FULFILLMENT_WORK_REPOSITORY_TOKEN,
  ROUTING_DECISION_REPOSITORY_TOKEN,
} from '../../fulfillment.tokens';
import type { RouteOrderInput, RoutingCommitOutcome } from '../types/routing-commit.types';
import type { IRoutingCommitService } from '../interfaces/routing-commit.service.interface';
import {
  FULFILLMENT_ROUTE_LOCK_TTL_MS,
  FULFILLMENT_ROUTE_TIMEOUT_MS,
  fulfillmentRouteLockKey,
} from './routing-commit-lock';

/** Sentinel for the timeout race, so a router resolving `undefined` is not mistaken for one. */
const ROUTE_TIMED_OUT = Symbol('route-timed-out');

@Injectable()
export class RoutingCommitService implements IRoutingCommitService {
  private readonly logger = new Logger(RoutingCommitService.name);

  constructor(
    @Inject(ROUTING_DECISION_REPOSITORY_TOKEN)
    private readonly decisions: RoutingDecisionRepositoryPort,
    @Inject(FULFILLMENT_WORK_REPOSITORY_TOKEN)
    private readonly works: FulfillmentWorkRepositoryPort
  ) {}

  async route(input: RouteOrderInput): Promise<RoutingCommitOutcome> {
    const lockKey = fulfillmentRouteLockKey(input.orderId);
    const token = await input.lock.acquire(lockKey, FULFILLMENT_ROUTE_LOCK_TTL_MS);

    if (token === null) {
      // A peer is mid-flight. This branch answers WITHOUT crossing the router
      // boundary — that is the property that matters, and it is sufficient: a
      // second call into the router is the double-ship. It deliberately reads no
      // persisted state either, because there is nothing it would do with it;
      // the peer owns the outcome.
      this.logger.log(`Routing contended; not calling the router: orderId=${input.orderId}`);
      return { status: 'contended' };
    }

    try {
      return await this.routeUnderLock(input);
    } finally {
      try {
        await input.lock.release(lockKey, token);
      } catch (releaseError) {
        // Never let a release failure mask the routing outcome. The lock expires
        // on its own, and the decision row is what protects the order anyway.
        this.logger.warn(
          `Failed to release routing lock ${lockKey}: ` +
            `${releaseError instanceof Error ? releaseError.message : String(releaseError)}`
        );
      }
    }
  }

  private async routeUnderLock(input: RouteOrderInput): Promise<RoutingCommitOutcome> {
    // Re-read INSIDE the lock. A cancellation flag read before acquiring is a
    // value from a moment that has passed (REVIEW C10).
    if (await input.isCancelled()) {
      return { status: 'skipped', reason: 'order-cancelled' };
    }

    const claimed = await this.claimOrResume(input);
    if (claimed.outcome !== null) {
      return claimed.outcome;
    }

    const decision = claimed.decision;
    const routingInput: RoutingInput = {
      orderId: input.orderId,
      lines: input.lines,
      shipTo: input.shipTo,
      requestedDeliveryMethod: input.requestedDeliveryMethod,
    };

    // Derived from the decision row's immutable id, never from a job id. A RETRY
    // re-derives this byte-identically (which is what makes the resume above
    // safe); a genuine RE-ROUTE is a new row and therefore a new key. The #2039
    // `reconcileId` lesson: a retry that mints a fresh key is not a retry.
    const idempotencyKey = deriveRouteIdempotencyKey(decision.id);

    let plan;
    try {
      plan = await this.callRouterWithinBudget(input, routingInput, idempotencyKey);
    } catch (error) {
      return this.leaveInDoubt(decision, 'error', error);
    }

    if (plan === ROUTE_TIMED_OUT) {
      return this.leaveInDoubt(decision, 'timeout');
    }

    let resolved: ResolvedRoutingPlan;
    try {
      assertRoutingPlanResolved(plan);
      resolved = plan;
    } catch (error) {
      if (error instanceof PendingRoutingPlanNotSupportedError) {
        return await this.refuse(decision, 'plan-pending', plan.decisionId);
      }
      throw error;
    }

    const refusal = this.refusalFor(resolved, routingInput);
    if (refusal !== null) {
      return await this.refuse(decision, refusal, resolved.decisionId);
    }

    // `RoutingAssignment` names an `orderLineId` but no variant, while a work
    // LINE needs both. The mapping comes from the routing input we sent, and it
    // is total here rather than by luck: `checkRoutingPlanConservesQuantities`
    // has already rejected any plan naming a line the input did not.
    const variantByOrderLineId = new Map(
      routingInput.lines.map((line) => [line.orderLineId, line.productVariantId])
    );

    return await this.commit(decision, resolved, variantByOrderLineId);
  }

  /**
   * Claim the intent, or resume the one already live for this order.
   *
   * **Resuming is what makes a crash between `claimIntent` and the commit
   * recoverable.** Without it the live row would refuse every subsequent attempt
   * and the order would be stranded forever, silently — the row cannot be
   * abandoned either, for the reason given in {@link leaveInDoubt}. Resuming
   * re-derives the identical idempotency key, which is exactly what an
   * idempotency key is for: the router recognises the retry and answers with the
   * same decision instead of making a second one.
   *
   * A live decision belonging to a DIFFERENT router is refused rather than
   * resumed — the guard is router-agnostic by design (DESIGN §5.3).
   */
  private async claimOrResume(
    input: RouteOrderInput
  ): Promise<
    { decision: RoutingDecision; outcome: null } | { decision: null; outcome: RoutingCommitOutcome }
  > {
    const live = await this.decisions.findLiveByOrderId(input.orderId);
    if (live !== null) {
      return this.resumeOrRefuse(live, input);
    }

    // No live decision: does the order already carry committed work? A cancelled
    // work object does not block — that is the re-route path (REVIEW C10).
    const existingWork = await this.works.findByOrderId(input.orderId);
    if (existingWork.some((work) => work.cancelledAt === null)) {
      return { decision: null, outcome: { status: 'skipped', reason: 'already-routed' } };
    }

    try {
      return {
        decision: await this.decisions.claimIntent({
          orderId: input.orderId,
          routerConnectionId: input.routerConnectionId,
        }),
        outcome: null,
      };
    } catch (error) {
      if (error instanceof RoutingDecisionAlreadyLiveError) {
        // The partial-unique index refused us — a peer won the race between our
        // guard read and this INSERT. This is the branch that proves the guard
        // read is a convenience and the INDEX is the enforcement.
        const winner = await this.decisions.findLiveByOrderId(input.orderId);
        if (winner === null) {
          // Terminalised between the refusal and this read. Nothing to resume.
          return { decision: null, outcome: { status: 'skipped', reason: 'already-routed' } };
        }
        return this.resumeOrRefuse(winner, input);
      }
      throw error;
    }
  }

  private resumeOrRefuse(
    live: RoutingDecision,
    input: RouteOrderInput
  ):
    | { decision: RoutingDecision; outcome: null }
    | { decision: null; outcome: RoutingCommitOutcome } {
    if (live.routerConnectionId !== input.routerConnectionId) {
      return { decision: null, outcome: { status: 'skipped', reason: 'already-live-elsewhere' } };
    }
    this.logger.log(
      `Resuming a live routing decision under its original key: ` +
        `orderId=${input.orderId} decisionId=${live.id}`
    );
    return { decision: live, outcome: null };
  }

  /**
   * Leave the decision `live` and report the doubt.
   *
   * **This is the finding of #2395, and the instinct it resists is to free the
   * order.** A timeout or a throwing `route()` is IN-DOUBT, not
   * nothing-happened: the router may be committing on its side right now.
   * Terminalising to `abandoned` would take the row OUT of the
   * `UNIQUE (orderId) WHERE state = 'live'` index, so the next attempt would
   * mint a NEW decision id and therefore a NEW idempotency key — one the vendor
   * cannot dedup against the first call. That is two plans and two shipments.
   *
   * Invoicing reached the identical conclusion from the other side:
   * `InvoiceRecord.blocksIssuanceElsewhere` keeps blocking on every failure
   * EXCEPT a terminal `rejected`, because only that one means the provider
   * definitely created nothing.
   *
   * The cost is a decision that stays `live` until something clears it, which is
   * a stranded order rather than a duplicated shipment — recoverable by hand,
   * and swept by the follow-up reaper. That trade is the whole point.
   */
  private leaveInDoubt(
    decision: RoutingDecision,
    cause: 'timeout' | 'error',
    error?: unknown
  ): RoutingCommitOutcome {
    this.logger.error(
      `Router call is IN DOUBT; leaving decision live so no second key can be minted: ` +
        `orderId=${decision.orderId} decisionId=${decision.id} cause=${cause}` +
        (error instanceof Error ? ` error=${error.message}` : '')
    );
    return { status: 'in-doubt', decisionId: decision.id, cause };
  }

  /** Which Wave-3a refusal, if any, this plan earns. */
  private refusalFor(
    plan: ResolvedRoutingPlan,
    routingInput: RoutingInput
  ): RoutingDecisionAbandonReason | null {
    if (!checkRoutingPlanConservesQuantities(routingInput, plan)) {
      return 'plan-not-conserving';
    }

    // Wave 3a cannot commit either of these, and committing the plan WITHOUT
    // them would silently drop quantities from a plan that just passed the
    // conservation check — the exact failure that check exists to catch.
    //
    // Inert until a router exists (#2408/#2409 inject the first one), which is
    // why the log below names the follow-up: whoever wires that router meets
    // this constraint at the point of failure instead of debugging it.
    if (plan.holds.length > 0) {
      return 'plan-carries-holds';
    }
    if (plan.unfulfillable.length > 0) {
      return 'plan-carries-unfulfillable';
    }

    return null;
  }

  private async refuse(
    decision: RoutingDecision,
    reason: RoutingDecisionAbandonReason,
    routerDecisionRef: string | null
  ): Promise<RoutingCommitOutcome> {
    // Safe to terminalise: the router DEFINITELY answered, so there is no
    // in-flight call a re-route could race. Contrast {@link leaveInDoubt}.
    const terminalised = await this.decisions.terminalise({
      decisionId: decision.id,
      state: 'abandoned',
      abandonReason: reason,
      // Kept even on the abandoned arm — it is the one value that lets an
      // operator correlate this refusal against the vendor's own log.
      routerDecisionRef,
    });

    if (!terminalised) {
      // A peer terminalised it first, so this refusal was NOT persisted. Report
      // contention rather than `refused`: the handler's `refused` arm tells the
      // operator the reason is durable on the decision row, and saying that
      // about a write that did not land would be a wrong reason — worse than
      // none. Nothing was written either way, so `contended` is the truth.
      this.logger.warn(
        `Routing refusal was not persisted (decision no longer live): ` +
          `orderId=${decision.orderId} decisionId=${decision.id} reason=${reason}`
      );
      return { status: 'contended' };
    }

    this.logger.warn(
      `Refused a routing plan: orderId=${decision.orderId} decisionId=${decision.id} ` +
        `reason=${reason}` +
        (reason === 'plan-carries-holds' || reason === 'plan-carries-unfulfillable'
          ? ' — holds and unfulfillable lines have no commit path in Wave 3a; see the' +
            ' follow-up filed against #2408/#2409 before emitting them from a router.'
          : '')
    );

    return { status: 'refused', decisionId: decision.id, reason };
  }

  /**
   * ADR-054 R1: the N work rows and the decision's terminalisation commit
   * together, or neither does.
   */
  private async commit(
    decision: RoutingDecision,
    plan: ResolvedRoutingPlan,
    variantByOrderLineId: ReadonlyMap<string, string>
  ): Promise<RoutingCommitOutcome> {
    const workIds = await this.works.runInTransaction(async (transaction) => {
      const created: string[] = [];

      for (const assignment of groupAssignmentsIntoWork(plan, variantByOrderLineId)) {
        const work = await this.works.create(
          {
            orderId: decision.orderId,
            locationId: assignment.locationId,
            deliveryMethod: assignment.deliveryMethod,
            assignedConnectionId: assignment.connectionId,
            lines: assignment.lines,
          },
          transaction
        );
        created.push(work.id);
      }

      const terminalised = await this.decisions.terminalise({
        decisionId: decision.id,
        state: 'committed',
        routerDecisionRef: plan.decisionId,
        transaction,
      });

      if (!terminalised) {
        // The decision is no longer live — a peer terminalised it while we were
        // creating work. Throwing is what makes ADR-054 R1 true: without it we
        // would commit work rows belonging to a decision that no longer claims
        // this order, which is the split state the single transaction exists to
        // make impossible.
        throw new RoutingDecisionNoLongerLiveError(decision.orderId, decision.id);
      }

      return created;
    });

    return { status: 'routed', decisionId: decision.id, workIds };
  }

  /**
   * The router call, bounded by a budget strictly below the lock TTL.
   *
   * The budget is not politeness: a router still running after the lock expired
   * could have its work committed concurrently with a peer that has since
   * acquired the lock.
   */
  private async callRouterWithinBudget(
    input: RouteOrderInput,
    routingInput: RoutingInput,
    idempotencyKey: string
  ): Promise<Awaited<ReturnType<typeof input.router.route>> | typeof ROUTE_TIMED_OUT> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const budget = new Promise<typeof ROUTE_TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(ROUTE_TIMED_OUT), FULFILLMENT_ROUTE_TIMEOUT_MS);
    });

    // The router promise OUTLIVES a timeout — `Promise.race` does not cancel the
    // loser. If it later rejects with nothing attached, Node raises an
    // unhandled rejection, which on a worker configured to exit on one would
    // take the process down for a call we had already stopped waiting on. The
    // no-op catch is the handler; the race still sees the original rejection if
    // it arrives before the budget expires.
    const routerCall = input.router.route(routingInput, { idempotencyKey });
    routerCall.catch((error: unknown) => {
      this.logger.warn(
        `Router settled with an error after its budget expired for order ` +
          `${input.orderId}: ${error instanceof Error ? error.message : String(error)}`
      );
    });

    try {
      return await Promise.race([routerCall, budget]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }
}

/**
 * One work object per distinct `(locationId, connectionId, deliveryMethod)`.
 *
 * ADR-054: **splits exist only at this grain**. A router that sources one order
 * from two locations produces two work objects; the commercial order is never
 * split. Assignments for the same triple collapse into one work object with
 * several lines, and a repeated `orderLineId` within a triple sums rather than
 * inserting twice — `fulfillment_work_lines` is unique per `(work, orderLine)`
 * and a duplicate would raise `DuplicateFulfillmentWorkLineError`, aborting the
 * whole transaction.
 */
function groupAssignmentsIntoWork(
  plan: ResolvedRoutingPlan,
  variantByOrderLineId: ReadonlyMap<string, string>
): {
  locationId: string | null;
  connectionId: string | null;
  deliveryMethod: string | null;
  lines: { orderLineId: string; productVariantId: string; totalQuantity: number }[];
}[] {
  const byTarget = new Map<
    string,
    {
      locationId: string | null;
      connectionId: string | null;
      deliveryMethod: string | null;
      lines: Map<string, { orderLineId: string; productVariantId: string; totalQuantity: number }>;
    }
  >();

  for (const assignment of plan.assignments) {
    // `JSON.stringify`, NOT a `|`-joined template. `deliveryMethod` is the
    // SOURCE'S OPAQUE method id (see `RoutingInput.requestedDeliveryMethod`), so
    // it may legitimately contain the delimiter — and a collision here does not
    // produce a tidy duplicate, it merges two lines bound for DIFFERENT
    // LOCATIONS into one work object and ships from the wrong place. It also
    // keeps `null` distinguishable from `''`, which a template collapses.
    const key = JSON.stringify([
      assignment.locationId,
      assignment.connectionId,
      assignment.deliveryMethod,
    ]);
    let bucket = byTarget.get(key);
    if (bucket === undefined) {
      bucket = {
        locationId: assignment.locationId,
        connectionId: assignment.connectionId,
        deliveryMethod: assignment.deliveryMethod,
        lines: new Map(),
      };
      byTarget.set(key, bucket);
    }

    const existing = bucket.lines.get(assignment.orderLineId);
    if (existing === undefined) {
      const productVariantId = variantByOrderLineId.get(assignment.orderLineId);
      if (productVariantId === undefined) {
        // Unreachable while the conservation check runs first. Thrown rather
        // than defaulted because the alternative is fabricating a sentinel
        // variant id onto a real work row — #2393 refuses a sentinel for exactly
        // this class of gap, and a work object pointing at no variant is
        // unpickable stock nothing would report.
        throw new Error(
          `Routing plan assigned an order line the input never named: ${assignment.orderLineId}`
        );
      }
      bucket.lines.set(assignment.orderLineId, {
        orderLineId: assignment.orderLineId,
        productVariantId,
        totalQuantity: assignment.quantity,
      });
    } else {
      existing.totalQuantity += assignment.quantity;
    }
  }

  return [...byTarget.values()].map((bucket) => ({
    locationId: bucket.locationId,
    connectionId: bucket.connectionId,
    deliveryMethod: bucket.deliveryMethod,
    lines: [...bucket.lines.values()],
  }));
}
