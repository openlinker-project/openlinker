/**
 * Fulfilment Work Reroute Sweep Handler (#3485, epic #3460)
 *
 * Handles `fulfillment.work.rerouteSweep` — one budgeted, per-run-locked pass
 * that re-enters routing for orders OpenLinker is HOLDING because routing
 * could not place them.
 *
 * ## Why this exists
 *
 * With the OMS on, an order stays in OpenLinker whatever routing decides. A
 * refused plan (typically a line out of stock) or a routing error is held with a
 * named block (`routing-refused` / `routing-failed`) instead of being created
 * in every product master. Nothing about the ORDER changes when stock arrives,
 * so no re-ingestion would ever route it again; this pass does, by enqueueing
 * one `fulfillment.work.route` per held order. That handler routes from the
 * stored snapshot (no marketplace call) and persists the new block — or clears
 * it — through the same `deriveRoutingHoldOutcome` rule the ingestion intercept
 * uses.
 *
 * A refused decision is terminalised to `abandoned`, which frees the
 * live-decision index, so a re-route mints a fresh decision under a fresh
 * idempotency key: re-routing is legal by construction, not by exception.
 *
 * ## Keyset, not frontier-as-query
 *
 * Its timeout- and relay-sweep siblings page by predicate because each
 * repaired row LEAVES their candidate set. Here an order that is still out of
 * stock is re-refused and rewrites an identical block; the `IS DISTINCT FROM`
 * guard (correctly) leaves `updatedAt` alone, so an oldest-first frontier would
 * re-read the same head page on every tick and starve everything behind it.
 * The pass pages by keyset on `internalOrderId` from a cursor in
 * `connection_cursors`, and wraps to the start on a short page. Keyset over a
 * shrinking set never skips a row, which is the failure an offset would have.
 *
 * ## Scope and the router connection
 *
 * The job runs once for the deployment under the nil-UUID system connection id
 * (the #2712 shape). The CHILD route jobs carry the selected router's
 * connection id, never a synthetic one — #2609's standing lesson that a shared
 * scope collapses per-scope lane accounting installation-wide. With no router
 * selected (the OMS switched off, or an ambiguous claim) the run enqueues
 * nothing and leaves the cursor where it is: held orders wait, and are not
 * released to the product masters by a sweep.
 *
 * @module apps/worker/src/sync/handlers
 */
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { REROUTABLE_FULFILLMENT_BLOCK_REASONS } from '@openlinker/core/fulfillment';
import {
  selectPrimaryFulfillmentRouter,
  type AuthorityClaimantInput,
} from '@openlinker/core/fulfillment-authority';
import { CONNECTION_PORT_TOKEN, type ConnectionPort } from '@openlinker/core/identifier-mapping';
import { ORDER_RECORD_SERVICE_TOKEN, type IOrderRecordService } from '@openlinker/core/orders';
import type {
  FulfillmentWorkRerouteSweepPayloadV1,
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
} from '@openlinker/core/sync';
import {
  JOB_ENQUEUE_TOKEN,
  SYNC_CURSORS_SERVICE_TOKEN,
  SYNC_LOCK_TOKEN,
  SyncJobExecutionError,
  type ISyncCursorsService,
  type JobEnqueuePort,
  type SyncLockPort,
} from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

import { resolveSweepBudget, resolveSweepLockTtlMs } from '../bounded-sweep';

type SyncJob = SyncJobEntity;

/**
 * Orders re-routed per run.
 *
 * One unit is one enqueued route job, and each route job is one LOCAL router
 * call (the OL router reads OpenLinker's own tables) — no marketplace call. 50
 * per 15-minute tick is 200 re-routes an hour, far above the handful of held
 * orders a v1 install carries, while keeping one tick's burst on the realtime
 * lane small.
 */
export const FULFILLMENT_REROUTE_SWEEP_PAGE_LIMIT_DEFAULT = 50;

/** Where the keyset cursor lives. Empty value = start from the beginning. */
export const FULFILLMENT_REROUTE_SWEEP_CURSOR_KEY = 'fulfillment.reroute.after';

/** This pass's own lock namespace (not `sweepLockKey`, which names a master). */
export function fulfillmentRerouteSweepLockKey(scopeId: string): string {
  return `fulfillment:work:reroute-sweep:${scopeId}`;
}

/**
 * The child route job's idempotency key: per order, per tick. A tick-scoped key
 * lets the next tick re-route an order still held, while a retry of THIS run
 * mints identical keys and dedupes against the jobs it already enqueued.
 */
export function buildRerouteRouteJobKey(orderId: string, tick: string): string {
  return `fulfillment:work:route:reroute:${orderId}:${tick}`;
}

@Injectable()
export class FulfillmentWorkRerouteSweepHandler implements SyncJobHandler {
  private readonly logger = new Logger(FulfillmentWorkRerouteSweepHandler.name);

  constructor(
    @Inject(ORDER_RECORD_SERVICE_TOKEN)
    private readonly orderRecords: IOrderRecordService,
    @Inject(CONNECTION_PORT_TOKEN)
    private readonly connections: ConnectionPort,
    @Inject(SYNC_CURSORS_SERVICE_TOKEN)
    private readonly cursors: ISyncCursorsService,
    @Inject(JOB_ENQUEUE_TOKEN)
    private readonly jobEnqueue: JobEnqueuePort,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly syncLock: SyncLockPort,
    private readonly configService: ConfigService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const scopeId = job.connectionId;
    const limit = resolveSweepBudget(
      this.getPageLimit(job) ?? FULFILLMENT_REROUTE_SWEEP_PAGE_LIMIT_DEFAULT
    );
    const lockKey = fulfillmentRerouteSweepLockKey(scopeId);
    const lockTtlMs = resolveSweepLockTtlMs(
      this.configService.get<string>('OL_MASTER_SWEEP_LOCK_TTL_MS')
    );

    const lockToken = await this.syncLock.acquire(lockKey, lockTtlMs);
    if (lockToken === null) {
      this.logger.log(`fulfillment.work.rerouteSweep skipped: ${lockKey} already in progress`);
      return { outcome: 'ok' };
    }

    try {
      await this.sweep(job, scopeId, limit);
      return { outcome: 'ok' };
    } catch (error) {
      // Nothing is lost on this path: the cursor only advances after every
      // enqueue in the page succeeded, so a failed run re-reads the same page.
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `fulfillment.work.rerouteSweep failed: ${message}`,
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

  private async sweep(job: SyncJob, scopeId: string, limit: number): Promise<void> {
    const selection = selectPrimaryFulfillmentRouter(await this.loadClaimants());
    if (selection.holder === null) {
      // No single router: nothing can route these orders, and releasing them to
      // the product masters is not this pass's decision. The cursor stays put.
      this.logger.log(
        `fulfillment.work.rerouteSweep: no router selected (${selection.reason}); ` +
          `held orders stay held`
      );
      return;
    }

    const stored = await this.cursors.getCursor(scopeId, FULFILLMENT_REROUTE_SWEEP_CURSOR_KEY);
    const afterOrderId = stored === null || stored === '' ? null : stored;

    const orderIds = await this.orderRecords.listOrderIdsByFulfillmentBlockReasons(
      REROUTABLE_FULFILLMENT_BLOCK_REASONS,
      { afterOrderId, limit }
    );

    // The tick token scopes each child's key to THIS run; a retry of the run
    // reuses the job's own creation instant, so it re-mints identical keys.
    const tick = new Date(job.createdAt).toISOString();
    for (const orderId of orderIds) {
      await this.jobEnqueue.enqueueJob({
        jobType: 'fulfillment.work.route',
        connectionId: selection.holder,
        payload: { schemaVersion: 1, orderId },
        idempotencyKey: buildRerouteRouteJobKey(orderId, tick),
      });
    }

    // A short page means the end of the set: wrap, so the next tick starts over
    // and an order that is still held is retried rather than left behind.
    const nextCursor = orderIds.length < limit ? '' : orderIds[orderIds.length - 1];
    await this.cursors.advanceCursor(scopeId, FULFILLMENT_REROUTE_SWEEP_CURSOR_KEY, nextCursor);

    this.logger.log(
      `fulfillment.work.rerouteSweep: enqueued=${String(orderIds.length)}, ` +
        `after=${afterOrderId ?? '<start>'}, wrapped=${String(nextCursor === '')}`
    );
  }

  /**
   * Every connection, whatever its status — the same claimant read the route
   * handler uses, so the sweep and the route it enqueues select the same router.
   */
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

  /** `pageLimit` off the payload when present; runtime-checked (jsonb). */
  private getPageLimit(job: SyncJob): number | undefined {
    const payload = job.payload as Partial<FulfillmentWorkRerouteSweepPayloadV1> | null | undefined;
    return typeof payload?.pageLimit === 'number' ? payload.pageLimit : undefined;
  }
}
