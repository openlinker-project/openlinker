/**
 * Fulfilment Routing Reap Sweep Handler (#2731)
 *
 * Handles `fulfillment.routing.reapSweep` — one budgeted, per-run-locked pass
 * that closes routing decisions stranded `live` past the routing-decision TTL
 * and routes their orders again.
 *
 * ## Why a decision strands
 *
 * `RoutingCommitService.leaveInDoubt` keeps a decision `live` when `route()`
 * times out or throws, because the router may still be committing (#2395). The
 * order is held as `routing-in-doubt`, which `fulfillment.work.rerouteSweep`
 * does not re-drive and `/orders` does not badge, and manual routing refuses
 * while a decision is live. Unless the order happens to be ingested again,
 * nothing ever routes it.
 *
 * ## What one reap does
 *
 * 1. The core service takes the order's routing lock (passed in from here, as
 *    `RoutingCommitService` takes it) and terminalises the decision
 *    (`stranded-past-ttl`) through the same `WHERE state = 'live'` guard a late
 *    commit takes. A held lock means a `route()` call is in flight, so the
 *    decision is left live as `busy`.
 * 2. This handler records `routing-stuck` under the order's `routing` producer.
 * 3. It enqueues `fulfillment.work.route` for the order, under the router that
 *    job will itself select. That job routes under the routing lock and writes
 *    the order's real hold state and `routing` attention itself, so a routed
 *    order clears `routing-stuck` with no second writer to coordinate.
 *
 * ## When the order cannot be re-routed now
 *
 * `fulfillment.work.route` returns without writing anything when no connection
 * claims routing, when the claim is ambiguous, or when no router resolves for
 * the holder (the OMS was switched off while the decision was stranded). Handing
 * the order to it then would leave a `routing-in-doubt` block naming a decision
 * that no longer exists, which `fulfillment.work.rerouteSweep` never re-drives.
 * So this handler asks the same two questions first, once per run, and when
 * either answer is "no" it writes `routing-failed` instead of enqueueing. The
 * reroute sweep re-drives that block once a router is available again. The same
 * block is written when the enqueue itself fails. Writing it always would race
 * the route job, which may already have written the order's real state.
 *
 * ## Frontier-as-query, and no `runBoundedSweep`
 *
 * A reaped decision leaves the `live` set, so the predicate is the cursor and an
 * offset would step over rows (the reasoning `FulfillmentWorkTimeoutSweepHandler`
 * records for #2712). The sweep primitives are reused; the offset machinery and
 * `sweepLockKey` (which names a master this pass does not have) are not.
 *
 * ## Global scope
 *
 * The live-decision set carries no connection axis, so the pass runs once for
 * the deployment under the nil-UUID system connection id. The route children
 * carry the connection that currently holds the routing claim — the one
 * `fulfillment.work.route` will select — never a synthetic id (#2609).
 *
 * @module apps/worker/src/sync/handlers
 * @see {@link IRoutingDecisionReaperService}
 */
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  FULFILLMENT_ROUTER_RESOLVER_TOKEN,
  resolveRoutingDecisionTtlMs,
  ROUTING_DECISION_REAPER_SERVICE_TOKEN,
  type FulfillmentRouterResolverPort,
  type IRoutingDecisionReaperService,
  type RoutingDecisionReapIntent,
} from '@openlinker/core/fulfillment';
import {
  selectPrimaryFulfillmentRouter,
  type AuthorityClaimantInput,
} from '@openlinker/core/fulfillment-authority';
import { CONNECTION_PORT_TOKEN, type ConnectionPort } from '@openlinker/core/identifier-mapping';
import { ORDER_RECORD_SERVICE_TOKEN, type IOrderRecordService } from '@openlinker/core/orders';
import type {
  FulfillmentRoutingReapSweepPayloadV1,
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
} from '@openlinker/core/sync';
import {
  JOB_ENQUEUE_TOKEN,
  SYNC_LOCK_TOKEN,
  SyncJobExecutionError,
  type JobEnqueuePort,
  type SyncLockPort,
} from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

import { resolveSweepBudget, resolveSweepLockTtlMs } from '../bounded-sweep';

type SyncJob = SyncJobEntity;

/**
 * Decisions examined per run.
 *
 * One unit is a local UPDATE plus, per reaped decision, one attention write and
 * one enqueue — no platform call. The live set is one row per order being
 * routed right now, so a stranded backlog larger than this is itself an alarm.
 */
export const FULFILLMENT_ROUTING_REAP_SWEEP_PAGE_LIMIT_DEFAULT = 50;

/** This pass's own lock namespace (not `sweepLockKey`, which names a master). */
export function fulfillmentRoutingReapSweepLockKey(scopeId: string): string {
  return `fulfillment:routing:reap-sweep:${scopeId}`;
}

/**
 * The route child's idempotency key: one per reaped DECISION. A retry of this
 * run re-mints the same key and dedupes; the next reap of the same order is a
 * different decision and therefore a different key.
 */
export function buildReapRouteJobKey(decisionId: string): string {
  return `fulfillment:work:route:reap:${decisionId}`;
}

@Injectable()
export class FulfillmentRoutingReapSweepHandler implements SyncJobHandler {
  private readonly logger = new Logger(FulfillmentRoutingReapSweepHandler.name);

  constructor(
    @Inject(ROUTING_DECISION_REAPER_SERVICE_TOKEN)
    private readonly reaper: IRoutingDecisionReaperService,
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecords: IOrderRecordService,
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly syncLock: SyncLockPort,
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connections: ConnectionPort,
    @Inject(FULFILLMENT_ROUTER_RESOLVER_TOKEN)
    private readonly routerResolver: FulfillmentRouterResolverPort,
    private readonly configService: ConfigService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const scopeId = job.connectionId;
    const limit = resolveSweepBudget(
      this.getPageLimit(job) ?? FULFILLMENT_ROUTING_REAP_SWEEP_PAGE_LIMIT_DEFAULT
    );
    // THE single resolution path: the same number selects candidates, is stamped
    // on the attention entry and is reported by the read endpoint.
    const ttlMs = resolveRoutingDecisionTtlMs(
      this.configService.get<string>('OL_ROUTING_DECISION_TTL_MS')
    );
    const lockKey = fulfillmentRoutingReapSweepLockKey(scopeId);
    const lockTtlMs = resolveSweepLockTtlMs(
      this.configService.get<string>('OL_MASTER_SWEEP_LOCK_TTL_MS')
    );

    const lockToken = await this.syncLock.acquire(lockKey, lockTtlMs);
    if (lockToken === null) {
      this.logger.log(`fulfillment.routing.reapSweep skipped: ${lockKey} already in progress`);
      return { outcome: 'ok' };
    }

    try {
      const result = await this.reaper.reapStranded({
        limit,
        ttlMs,
        now: new Date(),
        // `SyncLockPort` satisfies `RoutingLockPort` structurally — the same
        // lock `fulfillment.work.route` takes, so a reap never overlaps a call.
        lock: this.syncLock,
      });

      // Asked once per run, and only when something was reaped: the answer is
      // deployment-wide, not per order.
      const rerouteHolder =
        result.intents.length > 0 ? await this.resolveRerouteHolder() : null;

      let rerouted = 0;
      let fallbackHeld = 0;
      for (const intent of result.intents) {
        if (await this.handOff(intent, rerouteHolder)) {
          rerouted += 1;
        } else {
          fallbackHeld += 1;
        }
      }

      this.logger.log(
        `fulfillment.routing.reapSweep: examined=${String(result.examined)}, ` +
          `reaped=${String(result.reaped)}, raced=${String(result.raced)}, ` +
          `busy=${String(result.busy)}, ` +
          `failed=${String(result.failed)}, rerouted=${String(rerouted)}, ` +
          `fallbackHeld=${String(fallbackHeld)}, ttlMs=${String(result.ttlMs)}`
      );

      return { outcome: 'ok' };
    } catch (error) {
      // Only the frontier read reaches here; nothing was written, so the next
      // tick re-reads the same candidates.
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `fulfillment.routing.reapSweep failed: ${message}`,
        job.id,
        job.jobType,
        job.connectionId,
        error instanceof Error ? error : undefined
      );
    } finally {
      try {
        await this.syncLock.release(lockKey, lockToken);
      } catch (releaseError) {
        this.logger.warn(
          `Failed to release ${lockKey}: ${
            releaseError instanceof Error ? releaseError.message : String(releaseError)
          }`
        );
      }
    }
  }

  /**
   * The connection `fulfillment.work.route` would route under right now, or
   * `null` when that job would return without routing.
   *
   * The same selection and the same resolver the route job uses, so the answer
   * here and the job's own cannot disagree. A throw is read as `null`: the
   * fallback block keeps the order visible and the reroute sweep retries it,
   * whereas a wrong `true` would leave it with no block and no router.
   */
  private async resolveRerouteHolder(): Promise<string | null> {
    try {
      const selection = selectPrimaryFulfillmentRouter(await this.loadClaimants());
      if (selection.holder === null) {
        this.logger.warn(
          `fulfillment.routing.reapSweep: no connection can route now ` +
            `(reason=${selection.reason}); reaped orders are left to fulfillment.work.rerouteSweep`
        );
        return null;
      }

      const router = await this.routerResolver.resolve(selection.holder);
      if (router === null) {
        this.logger.warn(
          `fulfillment.routing.reapSweep: no router is wired for connection ${selection.holder}; ` +
            `reaped orders are left to fulfillment.work.rerouteSweep`
        );
        return null;
      }
      return selection.holder;
    } catch (error) {
      this.logger.error(
        `fulfillment.routing.reapSweep: could not resolve a router; reaped orders are left to ` +
          `fulfillment.work.rerouteSweep: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  /** The same claimant projection `FulfillmentWorkRouteHandler` selects from. */
  private async loadClaimants(): Promise<AuthorityClaimantInput[]> {
    const connections = await this.connections.list();
    return connections.map((connection) => ({
      connectionId: connection.id,
      isActive: connection.status === 'active',
      supportedCapabilities: [],
      enabledCapabilities: connection.enabledCapabilities,
      config: connection.config,
    }));
  }

  /**
   * Record the attention and route the order again. BEST-EFFORT throughout: the
   * reap is already durable, and failing the job would re-run a sweep whose
   * candidates have left the frontier, so nothing would be retried anyway.
   *
   * Returns `true` when the re-route was enqueued, `false` when the order was
   * left to the reroute sweep through the fallback block — because no router is
   * available now, or because the enqueue failed.
   */
  private async handOff(
    intent: RoutingDecisionReapIntent,
    rerouteHolder: string | null
  ): Promise<boolean> {
    try {
      await this.orderRecords.markOmsAttention(intent.orderId, 'routing', intent.attention);
    } catch (error) {
      this.logger.error(
        `Reaped routing decision ${intent.decisionId} but could not record its attention state ` +
          `for order ${intent.orderId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (rerouteHolder !== null) {
      try {
        await this.jobEnqueue.enqueueJob({
          jobType: 'fulfillment.work.route',
          // The connection the route job will select, so its lane scope is the
          // router actually doing the work (#2609).
          connectionId: rerouteHolder,
          payload: { schemaVersion: 1, orderId: intent.orderId },
          idempotencyKey: buildReapRouteJobKey(intent.decisionId),
        });
        return true;
      } catch (error) {
        this.logger.error(
          `Reaped routing decision ${intent.decisionId} but could not enqueue a re-route for order ` +
            `${intent.orderId}; leaving it to fulfillment.work.rerouteSweep: ${
              error instanceof Error ? error.message : String(error)
            }`
        );
      }
    }

    try {
      await this.orderRecords.markFulfillmentBlock(intent.orderId, intent.fallbackBlock);
    } catch (error) {
      // The order is now held as `routing-in-doubt` with no live decision. The
      // error log is the only trace, so it names both facts.
      this.logger.error(
        `routing_decision_reap_handoff_lost orderId=${intent.orderId} decisionId=${intent.decisionId}: ` +
          `neither the re-route nor the fallback block could be written: ${
            error instanceof Error ? error.message : String(error)
          }`
      );
    }
    return false;
  }

  /** `pageLimit` off the payload when present; runtime-checked (jsonb). */
  private getPageLimit(job: SyncJob): number | undefined {
    const payload = job.payload as Partial<FulfillmentRoutingReapSweepPayloadV1> | null | undefined;
    return typeof payload?.pageLimit === 'number' ? payload.pageLimit : undefined;
  }
}
