/**
 * Fulfilment Dispatch-Relay Reconcile Handler (#2728, ADR-054)
 *
 * Handles `fulfillment.work.relaySweep` — one budgeted, per-run-locked pass over
 * fulfilment work a holder reported SHIPPED whose dispatch relay never landed.
 *
 * ## Why a sweep and not a retry
 *
 * #2401 made the relay claim releasable, so a transiently-failed relay hands
 * `dispatchRelayedAt` back. That frees the SLOT and causes no retry:
 * `IFulfillmentProgressService.record` burns the `(workId, idempotencyKey)`
 * progress claim BEFORE reporting the intent and returns no intent for a duplicate,
 * so replaying the same vendor event produces nothing to re-drive. Only a later,
 * differently-keyed event would — and a second event arriving WHILE the first relay
 * is failing sees the claim held and answers `already-relayed`, so recovery would
 * need a third. If the holder's next event is `delivered`, there is no third.
 *
 * **The progress claim is NOT released to fix this**, and that is the design rather
 * than an omission: #2400 argues that key is permanent memory, not a held slot, and
 * un-burning it would let a replayed vendor event re-move counters — a missed relay
 * traded for corrupted quantities. `no-progress-claim-release.spec.ts` fails the
 * build if a release is ever added.
 *
 * ## Why this does not call `runBoundedSweep`
 *
 * The PROPERTIES that shape is after are delivered — budgeted, per-run locked,
 * never advancing past unfinished work, self-terminating, reported — but the
 * SCAN-OFFSET MECHANISM is not reused. `bounded-sweep.ts` draws the distinction in
 * its own header: the sweep family pages by `{limit, offset}` because its source is
 * a stable set a run reads through, whereas a pass whose remaining work is
 * re-derivable from a predicate uses frontier-as-query.
 *
 * This is unambiguously the second kind, and an offset would be a CORRECTNESS bug:
 * every page CONSUMES its own selection, because a relayed work acquires
 * `dispatchRelayedAt` and leaves the set. An offset over a shrinking set steps over
 * rows — here a work whose source is never told it shipped, i.e. the exact defect
 * this handler exists to fix. `FulfillmentWorkTimeoutSweepHandler` (#2712),
 * `ReservationExpiryHandler` (#2346) and `InventoryProvenanceBackfillHandler`
 * (#2317) record the same reasoning.
 *
 * So the sweep PRIMITIVES are reused (`resolveSweepBudget`, `resolveSweepLockTtlMs`)
 * and the offset machinery is not. **No `MasterSweepKind` member is added**: that
 * union is master-prefixed and `sweepLockKey` renders `master:{kind}:sweep:{id}`, a
 * false name for a pass with no master. This handler owns its own lock key and
 * needs no cursor — the predicate is the cursor.
 *
 * ## Lane: `bulk`, and the argument is stronger here than in #2712
 *
 * ADR-050 picks by cost of starvation. Every candidate has, by construction, been
 * unrelayed for at least the grace window, so one lane-slot's delay adds minutes to
 * a condition already measured in hours — while `realtime` holds
 * `fulfillment.work.dispatch` and `marketplace.order.sync`, where lateness costs a
 * shipment. Unlike the timeout sweep, which "makes no platform call and does its
 * work in bounded local writes", each candidate here fans a LIFECYCLE RELAY out to
 * N participant adapters. That heavy-outbound profile is what `bulk` is for, and is
 * the last thing that should hold a buyer-facing slot.
 *
 * ## Composition, not injection
 *
 * The read is core's (`IFulfillmentRelayReconcileService`) and the re-drive is
 * `orders`' (`IFulfillmentDispatchRelayService`). `libs/core/src/fulfillment` is a
 * registered zero-sibling-edge leaf and may not inject the second, so this handler
 * composes them — ADR-053's report-don't-perform discipline, the #2400 / #2712
 * shape. The evidence the split is right is that #2728 adds zero entries to
 * `check-no-injection-contracts.mjs`'s or `barrel-purity.spec.ts`'s allow-sets.
 *
 * ## Finding the stuck works by hand
 *
 * The escalation is a count plus a log rather than a persisted operator fact
 * (#2346's answer to the same AC; see `isFulfillmentRelayStuck` for why #3013's
 * counter columns do not transfer). The state is queryable directly:
 *
 * ```sql
 * SELECT w."id", w."orderId", MIN(c."claimedAt") AS "shippedAt"
 *   FROM "fulfillment_works" w
 *   JOIN "fulfillment_progress_claims" c
 *     ON c."workId" = w."id" AND c."eventKind" = 'shipped'
 *  WHERE w."dispatchRelayedAt" IS NULL
 *  GROUP BY w."id", w."orderId"
 * HAVING MIN(c."claimedAt") < now() - interval '24 hours';
 * ```
 *
 * @module apps/worker/src/sync/handlers
 * @see {@link IFulfillmentRelayReconcileService} for the frontier
 */
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  FULFILLMENT_RELAY_RECONCILE_SERVICE_TOKEN,
  resolveFulfillmentRelayGraceMs,
  resolveFulfillmentRelayStuckAfterMs,
  type IFulfillmentRelayReconcileService,
  type UnrelayedDispatchCandidate,
} from '@openlinker/core/fulfillment';
import {
  FULFILLMENT_DISPATCH_RELAY_SERVICE_TOKEN,
  type IFulfillmentDispatchRelayService,
} from '@openlinker/core/orders';
import type {
  FulfillmentWorkRelaySweepPayloadV1,
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
} from '@openlinker/core/sync';
import { SyncJobExecutionError, SYNC_LOCK_TOKEN, SyncLockPort } from '@openlinker/core/sync';
import { Logger } from '@openlinker/shared/logging';

import { resolveSweepBudget, resolveSweepLockTtlMs } from '../bounded-sweep';

type SyncJob = SyncJobEntity;

/**
 * Candidates examined per run — DERIVED, not copied.
 *
 * `bounded-sweep.ts` derives 100 for a child job doing a full per-product platform
 * sync, and #2712 uses 200 because one unit there is a bounded local write with no
 * platform call at all. One unit HERE is a lifecycle relay fanned out to every
 * order participant, in-process and sequential, each an outbound adapter write. At
 * 25 an unusually slow run stays far inside the 5-minute default lock TTL, and the
 * frontier resumes on the next tick with nothing to remember.
 *
 * A backlog is drained by widening ONE run through the payload's `pageLimit`, which
 * `resolveSweepBudget` clamps — never by moving this number.
 */
export const FULFILLMENT_RELAY_SWEEP_PAGE_LIMIT_DEFAULT = 25;

/** The family ceiling for a payload override, matching `SWEEP_BUDGET_MAX`. */
const FULFILLMENT_RELAY_SWEEP_PAGE_LIMIT_MAX = 500;

/**
 * This pass's own lock namespace.
 *
 * Deliberately NOT `sweepLockKey`, which renders `master:{kind}:sweep:{id}` and
 * would name a master this pass does not have. Distinct from the timeout sweep's
 * key: the two are different passes over the same table and must not exclude each
 * other.
 */
export function fulfillmentRelaySweepLockKey(scopeId: string): string {
  return `fulfillment:work:relay-sweep:${scopeId}`;
}

/** What one candidate's re-drive did. */
type RelayOutcome = 'relayed' | 'released' | 'already-relayed' | 'unknown-work' | 'failed';

@Injectable()
export class FulfillmentWorkRelaySweepHandler implements SyncJobHandler {
  private readonly logger = new Logger(FulfillmentWorkRelaySweepHandler.name);

  constructor(
    @Inject(FULFILLMENT_RELAY_RECONCILE_SERVICE_TOKEN)
    private readonly reconcile: IFulfillmentRelayReconcileService,
    @Inject(FULFILLMENT_DISPATCH_RELAY_SERVICE_TOKEN)
    private readonly relay: IFulfillmentDispatchRelayService,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly syncLock: SyncLockPort,
    private readonly configService: ConfigService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const scopeId = job.connectionId;
    const limit = resolveSweepBudget(this.getPageLimit(job), {
      default: FULFILLMENT_RELAY_SWEEP_PAGE_LIMIT_DEFAULT,
      max: FULFILLMENT_RELAY_SWEEP_PAGE_LIMIT_MAX,
    });
    // THE single resolution path for each bound. Resolved once per run and handed
    // to the service, so the number that selects candidates and the number an
    // operator reads on the escalation are the same value (#2229).
    const graceMs = resolveFulfillmentRelayGraceMs(
      this.configService.get<string>('OL_FULFILLMENT_RELAY_GRACE_MS')
    );
    const stuckAfterMs = resolveFulfillmentRelayStuckAfterMs(
      this.configService.get<string>('OL_FULFILLMENT_RELAY_STUCK_AFTER_MS')
    );
    const lockKey = fulfillmentRelaySweepLockKey(scopeId);
    const lockTtlMs = resolveSweepLockTtlMs(
      this.configService.get<string>('OL_MASTER_SWEEP_LOCK_TTL_MS')
    );

    const lockToken = await this.syncLock.acquire(lockKey, lockTtlMs);
    if (lockToken === null) {
      this.logger.log(`fulfillment.work.relaySweep skipped: ${lockKey} already in progress`);
      return { outcome: 'ok' };
    }

    try {
      const page = await this.reconcile.listUnrelayedDispatches({
        limit,
        graceMs,
        stuckAfterMs,
        now: new Date(),
      });

      const tally: Record<RelayOutcome, number> = {
        relayed: 0,
        released: 0,
        'already-relayed': 0,
        'unknown-work': 0,
        failed: 0,
      };

      // Sequential rather than concurrent, deliberately: each iteration fans a
      // lifecycle relay out to N participant adapters, and a page of 25 issued at
      // once would spike a source's rate limit for a recovery nobody is waiting on.
      for (const candidate of page.candidates) {
        const outcome = await this.redriveOne(candidate, page.stuckDetail);
        tally[outcome] += 1;
      }

      this.reportStalledPage(page.candidates.length, tally);

      this.logger.log(
        `fulfillment.work.relaySweep: examined=${String(page.candidates.length)}, ` +
          `relayed=${String(tally.relayed)}, released=${String(tally.released)}, ` +
          `alreadyRelayed=${String(tally['already-relayed'])}, ` +
          `unknownWork=${String(tally['unknown-work'])}, failed=${String(tally.failed)}, ` +
          `stuck=${String(page.stuckCount)}, stuckAfterMs=${String(page.stuckAfterMs)}`
      );

      return { outcome: 'ok' };
    } catch (error) {
      // Nothing is persisted by this pass itself — there is no cursor to hold — so
      // a failed run leaves every candidate exactly where it was and the next tick
      // re-reads them. Per-candidate failures never reach here; they are counted.
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `fulfillment.work.relaySweep failed: ${message}`,
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
   * Re-drive ONE candidate through the unchanged `relayDispatch`.
   *
   * That method takes `claimDispatchRelay`, which is the serialisation point
   * between this sweep and any concurrent progress-driven trigger — the
   * `waybillRelayedAt` idiom (#1947). **Nothing here claims for itself**: a second
   * writer of that column would defeat the guarantee the claim exists to provide.
   *
   * A `relayed` outcome does not assert a participant was reached — that status
   * reports the CLAIM decision, and three non-delivering paths land on it, all of
   * them structural. That is the correct reading for this pass: a structurally
   * unsupported relay keeps the claim, so the work leaves the frontier and is never
   * re-driven again. Only a TRANSIENT failure releases and stays, which is exactly
   * the set worth re-driving.
   */
  private async redriveOne(
    candidate: UnrelayedDispatchCandidate,
    stuckDetail: string
  ): Promise<RelayOutcome> {
    if (candidate.stuck) {
      // AC4: a work that cannot be relayed is observable rather than silently
      // recycled. It is still re-driven below — #1947 classifies
      // `adapter-unresolved` as transient precisely because a re-auth clears it,
      // so withholding the attempt would make a recoverable condition permanent.
      this.logger.error(
        `fulfillment_relay_reconcile_stuck: work ${candidate.intent.workId} ` +
          `(order ${candidate.orderId}, shipped ${candidate.shippedAt.toISOString()}): ${stuckDetail}`
      );
    }

    try {
      const outcome = await this.relay.relayDispatch(candidate.intent);

      if (outcome.status === 'released') {
        this.logger.warn(
          `Dispatch relay for work ${candidate.intent.workId} failed transiently again ` +
            `(${outcome.reason}); it stays on the frontier for the next tick`
        );
        return 'released';
      }
      if (outcome.status === 'unknown-work') {
        // Unreachable through the frontier, which joins `fulfillment_works` — so a
        // hit here is a delete racing the page, not a routine outcome.
        this.logger.warn(
          `Dispatch relay re-drive named work ${outcome.workId}, which no longer exists`
        );
        return 'unknown-work';
      }
      return outcome.status === 'already-relayed' ? 'already-relayed' : 'relayed';
    } catch (error) {
      // `relayDispatch` catches its own relay failures, so reaching here means the
      // claim read itself threw. Counted rather than propagated: one unreadable
      // work must not abort a page whose other candidates are re-drivable.
      this.logger.error(
        `Failed to re-drive the dispatch relay for work ${candidate.intent.workId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return 'failed';
    }
  }

  /**
   * Surface a page that made no progress.
   *
   * Candidates are ordered oldest-shipped first and a work leaves the frontier only
   * by acquiring `dispatchRelayedAt`, so one that keeps failing keeps its
   * `shippedAt`, stays at the head, and is re-read every tick — enough of them fill
   * the page and starve the rest. A scan offset is unavailable here
   * (frontier-as-query), so the condition is SURFACED rather than worked around,
   * exactly as #2346 and #2712 surface their own.
   *
   * `released` and `failed` are the two outcomes that leave a candidate in place;
   * `already-relayed` does not count, since a peer relaying IS progress.
   */
  private reportStalledPage(examined: number, tally: Record<RelayOutcome, number>): void {
    if (examined === 0) return;
    const stalled = tally.released + tally.failed;
    if (stalled === examined) {
      this.logger.error(
        `fulfillment_relay_reconcile_page_all_stalled: none of ${String(examined)} candidate(s) ` +
          `could be relayed; the oldest will be re-read next tick and may starve the page`
      );
    }
  }

  /**
   * `pageLimit` off the payload when present; the payload itself is optional.
   *
   * Typed against the declared payload rather than an inline shape (the
   * `fulfillment-work-timeout-sweep.handler.ts` precedent), so the interface that
   * documents this job's wire format is the one this reads. `Partial<>` because the
   * value crosses a jsonb column: the declared type says what a WRITER must send,
   * never what a reader may assume, so the runtime check stays.
   */
  private getPageLimit(job: SyncJob): number | undefined {
    const payload = job.payload as Partial<FulfillmentWorkRelaySweepPayloadV1> | null | undefined;
    return typeof payload?.pageLimit === 'number' ? payload.pageLimit : undefined;
  }
}
