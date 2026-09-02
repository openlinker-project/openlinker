/**
 * Reservation Expiry Handler (#2346, REVIEW § 3 C1)
 *
 * Handles `inventory.reservations.expire` — one budgeted, per-run-locked pass
 * over held reservations that are past `expiresAt`.
 *
 * ## Why this does not call `runBoundedSweep`
 *
 * The issue sketched this "over the `runBoundedSweep` shape", and the
 * *properties* that phrase is after are all delivered: budgeted, per-run locked,
 * never advancing past unfinished work, self-terminating, with a report. What is
 * not reused is the SCAN-OFFSET MECHANISM, and `bounded-sweep.ts` draws that
 * distinction in its own header — the sweep family pages by `{limit, offset}`
 * because its source is a stable set a run reads through, whereas a pass whose
 * remaining work is re-derivable from a predicate uses frontier-as-query.
 *
 * This pass is unambiguously the second kind, and an offset would be a
 * correctness bug rather than a stylistic mismatch. The candidate set is
 * `status = 'held' AND expiresAt < now`, and every page CONSUMES its own
 * selection: a released row leaves the set, and an EXTENDED row leaves it too
 * because `expiresAt` moves forward. An offset advancing over a shrinking set
 * steps over holds silently — which on this path means a hold that never
 * expires and stock that never returns. `InventoryProvenanceBackfillHandler`
 * (#2317) records the same reasoning for the same shape.
 *
 * So the sweep PRIMITIVES are reused (`resolveSweepBudget`,
 * `resolveSweepLockTtlMs`) and the offset machinery is not. **No
 * `MasterSweepKind` member is added**: that union is master-prefixed and
 * `sweepLockKey` renders `master:{kind}:sweep:{id}`, which would be a false name
 * for a pass that has no master. This handler owns its own lock key and needs no
 * cursor at all — the predicate is the cursor.
 *
 * ## No latch, deliberately
 *
 * Unlike the provenance backfill this pass never "completes": holds keep being
 * taken, so there is always more work eventually. It is a steady-state
 * reconciler, like `marketplace.offer.pauseStaleSweep`.
 *
 * ## Global scope
 *
 * Reservations carry no connection axis — the natural key is
 * `(orderRecordId, orderLineId, inventoryItemId)` — so the pass runs once for
 * the whole deployment under the nil-UUID `SYSTEM_CONNECTION_ID`, the precedent
 * `InventoryService` and the provenance backfill both use.
 *
 * @module apps/worker/src/sync/handlers
 * @see {@link IReservationExpiryService} for the fail-closed decision table
 */
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
} from '@openlinker/core/sync';
import { SyncJobExecutionError, SYNC_LOCK_TOKEN, SyncLockPort } from '@openlinker/core/sync';
import {
  RESERVATION_EXPIRY_SERVICE_TOKEN,
  type IReservationExpiryService,
} from '@openlinker/core/inventory';
import { Logger } from '@openlinker/shared/logging';
import { resolveSweepBudget, resolveSweepLockTtlMs } from '../bounded-sweep';

type SyncJob = SyncJobEntity;

/** Candidates examined per run. */
const RESERVATION_EXPIRY_PAGE_LIMIT_DEFAULT = 200;

/**
 * This pass's own lock namespace.
 *
 * Deliberately NOT `sweepLockKey`, which renders `master:{kind}:sweep:{id}` and
 * would name a master this pass does not have.
 */
export function reservationExpiryLockKey(scopeId: string): string {
  return `inventory:reservations:expire:${scopeId}`;
}

@Injectable()
export class ReservationExpiryHandler implements SyncJobHandler {
  private readonly logger = new Logger(ReservationExpiryHandler.name);

  constructor(
    @Inject(RESERVATION_EXPIRY_SERVICE_TOKEN)
    private readonly expiry: IReservationExpiryService,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly syncLock: SyncLockPort,
    private readonly configService: ConfigService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const scopeId = job.connectionId;
    const limit = resolveSweepBudget(
      this.getPageLimit(job) ?? RESERVATION_EXPIRY_PAGE_LIMIT_DEFAULT
    );
    const lockKey = reservationExpiryLockKey(scopeId);
    const lockTtlMs = resolveSweepLockTtlMs(
      this.configService.get<string>('OL_MASTER_SWEEP_LOCK_TTL_MS')
    );

    const lockToken = await this.syncLock.acquire(lockKey, lockTtlMs);
    if (lockToken === null) {
      this.logger.log(`inventory.reservations.expire skipped: ${lockKey} already in progress`);
      return { outcome: 'ok' };
    }

    try {
      const result = await this.expiry.expireDueReservations({ limit });

      this.logger.log(
        `inventory.reservations.expire: examined=${String(result.examined)}, ` +
          `released=${String(result.released)}, extended=${String(result.extended)}, ` +
          `escalated=${String(result.escalated)}, failed=${String(result.failed)}`
      );

      if (result.escalated > 0) {
        // Surfaced with job context as well as from the service, because the
        // number an operator can act on is the per-run one. W2-15 turns this
        // into a needs-attention entry; until then the counter and the log ARE
        // the signal — no fact is emitted into a sink that does not exist.
        this.logger.error(
          `inventory.reservations.expire: ${String(result.escalated)} hold(s) extended past the ` +
            `obligation age bound — they are NOT released (that would republish ` +
            `possibly-promised stock) and need an operator to resolve their orders`
        );
      }

      return { outcome: 'ok' };
    } catch (error) {
      // Nothing is persisted on this path — there is no cursor to hold — so a
      // failed run leaves every candidate exactly where it was and the next tick
      // re-reads them. Per-candidate failures never reach here; the service
      // counts them and continues.
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `inventory.reservations.expire failed: ${message}`,
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

  /** `pageLimit` off the payload when present; the payload itself is optional. */
  private getPageLimit(job: SyncJob): number | undefined {
    const payload = job.payload as { pageLimit?: unknown } | null | undefined;
    return typeof payload?.pageLimit === 'number' ? payload.pageLimit : undefined;
  }
}

export { RESERVATION_EXPIRY_PAGE_LIMIT_DEFAULT };
