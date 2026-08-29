/**
 * Reservation Consume Handler (#2347, REVIEW § 3 C8)
 *
 * Handles `inventory.reservations.consume` — one budgeted, per-run-locked pass
 * over shipments that have shipped but whose order's reservations are still
 * held.
 *
 * ## Why this does not call `runBoundedSweep`
 *
 * Same reason as its `inventory.reservations.expire` sibling (#2346), and worth
 * restating because it is a correctness argument rather than a style one. The
 * sweep family pages by `{limit, offset}` because its source is a stable set a
 * run reads through; this pass's candidate set **consumes its own selection** —
 * a shipment whose marker gets stamped leaves the set permanently — so an
 * advancing offset over a shrinking set steps over shipments silently. Here that
 * means a hold that is never consumed and ATP understated forever.
 *
 * So the sweep PRIMITIVES are reused (`resolveSweepBudget`,
 * `resolveSweepLockTtlMs`) and the offset machinery is not. **No
 * `MasterSweepKind` member is added**: that union is master-prefixed and
 * `sweepLockKey` renders `master:{kind}:sweep:{id}`, a false name for a pass
 * with no master. This handler owns its lock key and needs no cursor — the
 * predicate is the cursor.
 *
 * ## Global scope
 *
 * Reservations key on `(order, line, position)` and shipments on the order, so
 * neither carries a connection axis. The pass runs once for the deployment under
 * the nil-UUID system connection, the precedent `InventoryService` and the
 * provenance backfill both use.
 *
 * ## Expect a one-time marker backfill on first deployment
 *
 * On an existing install every historical `dispatched` / `in-transit` /
 * `delivered` shipment is initially a candidate. Most consume nothing (no ledger
 * rows existed when they shipped), get marked, and leave the set forever. At the
 * default cadence and budget that is ~14.4k/day and self-limiting — the first
 * days' log volume is expected, not a defect.
 *
 * @module apps/worker/src/sync/handlers
 * @see {@link IShipmentReservationConsumeService} for the consume-then-claim ordering
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
  SHIPMENT_RESERVATION_CONSUME_SERVICE_TOKEN,
  type IShipmentReservationConsumeService,
} from '@openlinker/core/shipping';
import { Logger } from '@openlinker/shared/logging';
import { resolveSweepBudget, resolveSweepLockTtlMs } from '../bounded-sweep';

type SyncJob = SyncJobEntity;

/** Candidates examined per run. */
const RESERVATION_CONSUME_PAGE_LIMIT_DEFAULT = 100;

/**
 * This pass's own lock namespace.
 *
 * Deliberately NOT `sweepLockKey`, which renders `master:{kind}:sweep:{id}` and
 * would name a master this pass does not have.
 */
export function reservationConsumeLockKey(scopeId: string): string {
  return `inventory:reservations:consume:${scopeId}`;
}

@Injectable()
export class ReservationConsumeHandler implements SyncJobHandler {
  private readonly logger = new Logger(ReservationConsumeHandler.name);

  constructor(
    @Inject(SHIPMENT_RESERVATION_CONSUME_SERVICE_TOKEN)
    private readonly consume: IShipmentReservationConsumeService,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly syncLock: SyncLockPort,
    private readonly configService: ConfigService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const scopeId = job.connectionId;
    const limit = resolveSweepBudget(
      this.getPageLimit(job) ?? RESERVATION_CONSUME_PAGE_LIMIT_DEFAULT
    );
    const lockKey = reservationConsumeLockKey(scopeId);
    const lockTtlMs = resolveSweepLockTtlMs(
      this.configService.get<string>('OL_MASTER_SWEEP_LOCK_TTL_MS')
    );

    const lockToken = await this.syncLock.acquire(lockKey, lockTtlMs);
    if (lockToken === null) {
      this.logger.log(`inventory.reservations.consume skipped: ${lockKey} already in progress`);
      return { outcome: 'ok' };
    }

    try {
      const result = await this.consume.consumeDueShipments({ limit });

      this.logger.log(
        `inventory.reservations.consume: examined=${String(result.examined)}, ` +
          `consumed=${String(result.consumed)}, ` +
          `reservationsConsumed=${String(result.reservationsConsumed)}, ` +
          `alreadyTerminal=${String(result.alreadyTerminal)}, ` +
          `skipped=${String(result.skipped)}, failed=${String(result.failed)}`
      );

      return { outcome: 'ok' };
    } catch (error) {
      // Nothing is persisted on this path — there is no cursor — so a failed run
      // leaves every candidate exactly where it was and the next tick re-reads
      // them. Per-candidate failures never reach here; the service counts them
      // and continues.
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `inventory.reservations.consume failed: ${message}`,
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

export { RESERVATION_CONSUME_PAGE_LIMIT_DEFAULT };
