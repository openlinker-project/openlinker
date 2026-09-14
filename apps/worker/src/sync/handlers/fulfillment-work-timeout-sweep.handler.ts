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
  FULFILLMENT_DISPATCH_TIMEOUT_SERVICE_TOKEN,
  resolveFulfillmentDispatchTimeoutMs,
  type FulfillmentAcceptanceAttentionIntent,
  type IFulfillmentDispatchTimeoutService,
} from '@openlinker/core/fulfillment';
import { ORDER_RECORD_SERVICE_TOKEN, type IOrderRecordService } from '@openlinker/core/orders';
import type {
  FulfillmentWorkTimeoutSweepPayloadV1,
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
} from '@openlinker/core/sync';
import { SyncJobExecutionError, SYNC_LOCK_TOKEN, SyncLockPort } from '@openlinker/core/sync';
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
