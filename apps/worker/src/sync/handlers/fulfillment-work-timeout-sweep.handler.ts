/**
 * Fulfilment Work Timeout Sweep Handler (#2712, ADR-054)
 *
 * Handles `fulfillment.work.timeoutSweep` — one budgeted, per-run-locked pass
 * over `submitted` fulfilment work whose holder never answered.
 *
 * ## Why this does not call `runBoundedSweep`
 *
 * The PROPERTIES that shape is after are all delivered — budgeted, per-run
 * locked, never advancing past unfinished work, self-terminating, reported —
 * but the SCAN-OFFSET MECHANISM is not reused, and `bounded-sweep.ts` draws
 * that distinction in its own header: the sweep family pages by
 * `{limit, offset}` because its source is a stable set a run reads through,
 * whereas a pass whose remaining work is re-derivable from a predicate uses
 * frontier-as-query.
 *
 * This pass is unambiguously the second kind, and an offset would be a
 * CORRECTNESS bug rather than a stylistic mismatch. The candidate set is
 * `requestStatus = 'submitted' AND updatedAt < cutoff`, and every page CONSUMES
 * its own selection: a reaped row moves to `rejected` and leaves the set. An
 * offset advancing over a shrinking set steps over rows — which on this path
 * means a work that is never reaped and an order that stalls for ever, i.e. the
 * exact defect this handler exists to fix. `ReservationExpiryHandler` (#2346)
 * and `InventoryProvenanceBackfillHandler` (#2317) record the same reasoning.
 *
 * So the sweep PRIMITIVES are reused (`resolveSweepBudget`,
 * `resolveSweepLockTtlMs`) and the offset machinery is not. **No
 * `MasterSweepKind` member is added**: that union is master-prefixed and
 * `sweepLockKey` renders `master:{kind}:sweep:{id}`, a false name for a pass
 * with no master. This handler owns its own lock key and needs no cursor at all
 * — the predicate is the cursor.
 *
 * ## Global scope
 *
 * `IDX_fulfillment_works_request_status` carries no connection axis, and a
 * stalled dispatch is stalled whoever holds it, so the pass runs once for the
 * whole deployment under the nil-UUID system connection id — the precedent the
 * three reservation sweeps use.
 *
 * ## The attention write lives HERE, not in core
 *
 * `libs/core/src/fulfillment` is a registered zero-sibling-edge leaf and
 * `scripts/check-no-injection-contracts.mjs` forbids it from injecting an
 * `orders` service, so the core service REPORTS intents and this handler
 * performs the write (ADR-053's report-don't-perform discipline, the #2400
 * shape). The evidence the split is right is that #2712 adds zero entries to
 * that guard's allow-set.
 *
 * @module apps/worker/src/sync/handlers
 * @see {@link IFulfillmentDispatchTimeoutService} for the reap rules
 */
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  buildFulfillmentDispatchDedupeKey,
  FULFILLMENT_DISPATCH_TIMEOUT_SERVICE_TOKEN,
  resolveFulfillmentDispatchTimeoutMs,
  type FulfillmentAcceptanceAttentionIntent,
  type IFulfillmentDispatchTimeoutService,
} from '@openlinker/core/fulfillment';
import { CONNECTION_PORT_TOKEN, type ConnectionPort } from '@openlinker/core/identifier-mapping';
import { ORDER_RECORD_SERVICE_TOKEN, type IOrderRecordService } from '@openlinker/core/orders';
import type {
  FulfillmentWorkTimeoutSweepPayloadV1,
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
} from '@openlinker/core/sync';
import {
  JOB_ENQUEUE_TOKEN,
  SYNC_CURSORS_SERVICE_TOKEN,
  SyncJobExecutionError,
  SYNC_LOCK_TOKEN,
  SyncLockPort,
  type ISyncCursorsService,
  type JobEnqueuePort,
} from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

import { resolveSweepBudget, resolveSweepLockTtlMs } from '../bounded-sweep';

type SyncJob = SyncJobEntity;

/**
 * Candidates examined per run.
 *
 * One unit here is a bounded local write plus, per REAPED order, one further
 * local read — no platform call at all — so this is deliberately the same 200
 * `ReservationExpiryHandler` uses rather than the 100 `bounded-sweep.ts` derives
 * for a child job doing a full per-product platform sync.
 */
export const FULFILLMENT_TIMEOUT_SWEEP_PAGE_LIMIT_DEFAULT = 200;

/** Keyset cursor of the stalled-`unsubmitted` pass (#3476). Empty = start. */
export const FULFILLMENT_UNSUBMITTED_SWEEP_CURSOR_KEY = 'fulfillment.unsubmitted.after';

/** The capability `fulfillment.work.dispatch` resolves the holder through. */
const FULFILLMENT_EXECUTOR_CAPABILITY = 'FulfillmentExecutor';

/**
 * This pass's own lock namespace.
 *
 * Deliberately NOT `sweepLockKey`, which renders `master:{kind}:sweep:{id}` and
 * would name a master this pass does not have.
 */
export function fulfillmentTimeoutSweepLockKey(scopeId: string): string {
  return `fulfillment:work:timeout-sweep:${scopeId}`;
}

@Injectable()
export class FulfillmentWorkTimeoutSweepHandler implements SyncJobHandler {
  private readonly logger = new Logger(FulfillmentWorkTimeoutSweepHandler.name);

  constructor(
    @Inject(FULFILLMENT_DISPATCH_TIMEOUT_SERVICE_TOKEN)
    private readonly timeouts: IFulfillmentDispatchTimeoutService,
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
      this.getPageLimit(job) ?? FULFILLMENT_TIMEOUT_SWEEP_PAGE_LIMIT_DEFAULT
    );
    // THE single resolution path (AC3). Resolved once per run and handed to the
    // service, so the number that selects candidates and the number stamped on
    // every rejection and attention entry are the same value.
    const timeoutMs = resolveFulfillmentDispatchTimeoutMs(
      this.configService.get<string>('OL_FULFILLMENT_DISPATCH_TIMEOUT_MS')
    );
    const lockKey = fulfillmentTimeoutSweepLockKey(scopeId);
    const lockTtlMs = resolveSweepLockTtlMs(
      this.configService.get<string>('OL_MASTER_SWEEP_LOCK_TTL_MS')
    );

    const lockToken = await this.syncLock.acquire(lockKey, lockTtlMs);
    if (lockToken === null) {
      this.logger.log(`fulfillment.work.timeoutSweep skipped: ${lockKey} already in progress`);
      return { outcome: 'ok' };
    }

    try {
      const result = await this.timeouts.reapTimedOutDispatches({
        limit,
        timeoutMs,
        now: new Date(),
      });

      await this.writeAttention(result.attentionIntents);

      this.logger.log(
        `fulfillment.work.timeoutSweep: examined=${String(result.examined)}, ` +
          `reaped=${String(result.reaped)}, raced=${String(result.raced)}, ` +
          `skippedUnassigned=${String(result.skippedUnassigned)}, ` +
          `failed=${String(result.failed)}, timeoutMs=${String(result.timeoutMs)}`
      );

      await this.handleStalledUnsubmitted(scopeId, limit, timeoutMs, new Date());

      return { outcome: 'ok' };
    } catch (error) {
      // Nothing is persisted on this path — there is no cursor to hold — so a
      // failed run leaves every candidate exactly where it was and the next
      // tick re-reads them. Per-candidate failures never reach here; the
      // service counts them and continues.
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `fulfillment.work.timeoutSweep failed: ${message}`,
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
   * The second pass (#3476): works routed to a holder and never offered to it.
   *
   * Such a work sits `unsubmitted` because its dispatch job died before the
   * handshake could claim it — the holder's connection did not have
   * `FulfillmentExecutor` enabled, so every attempt failed to resolve an
   * executor. Nothing else ever looks at it: the reap above reads `submitted`
   * only, re-routing answers `already-routed`, and the bare dispatch key
   * swallows a second enqueue. So this pass raises A3-X for its order, and
   * re-drives the dispatch once the connection can execute.
   *
   * Keyset-paged from a cursor: raising the state does not write the work row,
   * so the set does not shrink and a frontier read would starve every work
   * behind the first page. The cursor advances even when a write below fails —
   * each failure is logged, and the keyset wraps to the start and retries it.
   */
  private async handleStalledUnsubmitted(
    scopeId: string,
    limit: number,
    timeoutMs: number,
    now: Date
  ): Promise<void> {
    const stored = await this.cursors.getCursor(scopeId, FULFILLMENT_UNSUBMITTED_SWEEP_CURSOR_KEY);
    const afterWorkId = stored === null || stored === '' ? null : stored;

    const result = await this.timeouts.findStalledUnsubmitted({
      limit,
      timeoutMs,
      now,
      afterWorkId,
    });

    await this.writeAttention(result.attentionIntents);

    // One generation per timeout window, so a work is re-driven at most once a
    // window and a still-retrying original job is not joined by a pile of
    // copies. The handshake claim is the guarantee against a double dispatch;
    // this only bounds the queue.
    const generation = String(Math.floor(now.getTime() / timeoutMs));
    const executable = new Map<string, boolean>();
    let redriven = 0;
    let waiting = 0;

    for (const work of result.works) {
      let canExecute = executable.get(work.assignedConnectionId);
      if (canExecute === undefined) {
        canExecute = await this.connectionCanExecute(work.assignedConnectionId);
        executable.set(work.assignedConnectionId, canExecute);
      }

      if (!canExecute) {
        // Re-driving now would only dead-letter another job. The A3-X state
        // above is what tells the operator to enable the capability.
        waiting += 1;
        continue;
      }

      try {
        await this.jobEnqueue.enqueueJob({
          jobType: 'fulfillment.work.dispatch',
          // The work's own holder — never a synthetic scope (#2609).
          connectionId: work.assignedConnectionId,
          payload: {
            workId: work.workId,
            orderId: work.orderId,
            // `null`: the work was never claimed, so this is a first dispatch.
            expectedAssignmentAttempt: null,
          },
          idempotencyKey: buildFulfillmentDispatchDedupeKey(work.workId, generation),
        });
        redriven += 1;
      } catch (error) {
        this.logger.error(
          `Could not re-drive the dispatch of stalled work ${work.workId} (order ${work.orderId}): ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    await this.cursors.advanceCursor(
      scopeId,
      FULFILLMENT_UNSUBMITTED_SWEEP_CURSOR_KEY,
      result.nextAfterWorkId ?? ''
    );

    if (result.works.length > 0) {
      this.logger.warn(
        `fulfillment.work.timeoutSweep stalled-unsubmitted: found=${String(result.works.length)}, ` +
          `redriven=${String(redriven)}, waitingForExecutor=${String(waiting)}`
      );
    }
  }

  /**
   * Can a dispatch to this connection resolve an executor right now?
   *
   * The same two conditions `getCapabilityAdapter` checks before the adapter
   * itself: the connection is active and has `FulfillmentExecutor` enabled. A
   * failed read answers `false` — the work keeps its A3-X state and is looked
   * at again next tick, which is safer than enqueueing a job bound to fail.
   */
  private async connectionCanExecute(connectionId: string): Promise<boolean> {
    try {
      const connection = await this.connections.get(connectionId);
      return (
        connection.status === 'active' &&
        connection.enabledCapabilities.includes(FULFILLMENT_EXECUTOR_CAPABILITY)
      );
    } catch (error) {
      this.logger.warn(
        `Could not read connection ${connectionId} while checking whether stalled work can be re-driven: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return false;
    }
  }

  /**
   * Write each reported A3-X verdict, BEST-EFFORT.
   *
   * The reap is already durable by the time this runs, so a failure here must
   * not fail the job: a retry would re-run a sweep whose candidates have all
   * left the frontier, reap nothing, and therefore never re-report the
   * attention it was retried for. The next tick recomputes the same verdict for
   * any order still holding an unaccepted work, which is what makes the state
   * level-triggered rather than dependent on this one write succeeding.
   */
  private async writeAttention(
    intents: readonly FulfillmentAcceptanceAttentionIntent[]
  ): Promise<void> {
    for (const intent of intents) {
      try {
        await this.orderRecords.markOmsAttention(intent.orderId, 'acceptance', intent.outcome);
      } catch (error) {
        this.logger.error(
          `Reaped order ${intent.orderId} but could not record its acceptance attention state: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  /**
   * `pageLimit` off the payload when present; the payload itself is optional.
   *
   * Typed against the declared payload rather than an inline shape (the
   * `fulfillment-work-route.handler.ts` precedent), so the interface that
   * documents this job's wire format is the one this reads — a second, inline
   * shape is how the two drift. `Partial<>` because the value crosses a jsonb
   * column: the declared type says what a WRITER must send, never what a reader
   * may assume, so the runtime check stays.
   */
  private getPageLimit(job: SyncJob): number | undefined {
    const payload = job.payload as Partial<FulfillmentWorkTimeoutSweepPayloadV1> | null | undefined;
    return typeof payload?.pageLimit === 'number' ? payload.pageLimit : undefined;
  }
}
