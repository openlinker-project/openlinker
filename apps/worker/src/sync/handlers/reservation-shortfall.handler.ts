/**
 * Reservation Shortfall Handler (#2349, design § 4.2 story I6)
 *
 * Handles `inventory.reservations.shortfall` — one budgeted, per-run-locked,
 * cursor-resumed pass that names the orders a master's stock drop puts at risk.
 *
 * ## Why this uses a SCAN OFFSET, unlike its two reservation siblings
 *
 * `bounded-sweep.ts` draws the line: the scan-offset family pages through a
 * stable set a run reads across, while a pass whose remaining work is
 * re-derivable from a predicate uses frontier-as-query. The expiry (#2346) and
 * consume (#2347) sweeps are the second kind and correctly carry no cursor —
 * every page there CONSUMES its own selection, because releasing or extending a
 * hold removes it from the candidate set.
 *
 * This pass is the first kind, and the reason is the thing that most
 * distinguishes it: **it repairs nothing.** A short position stays short across
 * runs, so the predicate never shrinks. Frontier-as-query here would re-read
 * the same head page forever and never reach the tail — a shortfall past the
 * first page would be permanently invisible, silently, which is the exact
 * failure mode the whole issue exists to remove.
 *
 * Both halves therefore carry their own offset, and both wrap to 0 on a short
 * page so a cycle restarts rather than paging off the end.
 *
 * ## Global scope
 *
 * Reservations key on `(orderRecordId, orderLineId, inventoryItemId)` and carry
 * no connection axis, so the pass runs once for the whole deployment under the
 * nil-UUID system connection — the precedent `InventoryService`, the provenance
 * backfill and both reservation sweeps already use.
 *
 * ## No latch
 *
 * Like its siblings and unlike the provenance backfill, this pass never
 * "completes": stock keeps moving, so there is always more to observe.
 *
 * @module apps/worker/src/sync/handlers
 * @see {@link IReservationShortfallService} for the episode lifecycle
 */
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  SyncJobHandler,
  SyncJobHandlerResult,
  SyncJob as SyncJobEntity,
} from '@openlinker/core/sync';
import {
  SyncJobExecutionError,
  SYNC_LOCK_TOKEN,
  SyncLockPort,
  SYNC_CURSORS_SERVICE_TOKEN,
} from '@openlinker/core/sync';
import { ISyncCursorsService } from '@openlinker/core/sync';
import {
  RESERVATION_SHORTFALL_SERVICE_TOKEN,
  type IReservationShortfallService,
} from '@openlinker/core/inventory';
import { Logger } from '@openlinker/shared/logging';
import { resolveSweepBudget, resolveSweepLockTtlMs } from '../bounded-sweep';

type SyncJob = SyncJobEntity;

/** Positions examined per run by the detection half. */
const SHORTFALL_DETECT_LIMIT_DEFAULT = 200;
/** Open episodes examined per run by the close half. */
const SHORTFALL_CLOSE_LIMIT_DEFAULT = 200;

const DETECT_CURSOR_KEY = 'inventory.reservationShortfall.detectOffset';
const CLOSE_CURSOR_KEY = 'inventory.reservationShortfall.closeOffset';

/**
 * This pass's own lock namespace.
 *
 * Deliberately NOT `sweepLockKey`, which renders `master:{kind}:sweep:{id}` and
 * would name a master this pass does not have.
 */
export function reservationShortfallLockKey(scopeId: string): string {
  return `inventory:reservations:shortfall:${scopeId}`;
}

@Injectable()
export class ReservationShortfallHandler implements SyncJobHandler {
  private readonly logger = new Logger(ReservationShortfallHandler.name);

  constructor(
    @Inject(RESERVATION_SHORTFALL_SERVICE_TOKEN)
    private readonly shortfalls: IReservationShortfallService,
    @Inject(SYNC_LOCK_TOKEN)
    private readonly syncLock: SyncLockPort,
    // `ISyncCursorsService`, deliberately NOT `ConnectionCursorRepositoryPort`.
    // A `*RepositoryPort` is an intra-context contract that
    // `check-cross-context-imports` denies by shape; the handlers that still
    // reach for it are pre-existing debt tracked in #722, and that allow-list's
    // own comment prescribes this seam as the fix. `advanceCursor` is an atomic
    // upsert, which is exactly what a scan offset wants.
    @Inject(SYNC_CURSORS_SERVICE_TOKEN)
    private readonly cursors: ISyncCursorsService,
    private readonly configService: ConfigService
  ) {}

  async execute(job: SyncJob): Promise<SyncJobHandlerResult> {
    const scopeId = job.connectionId;
    const detectLimit = resolveSweepBudget(
      this.getNumber(job, 'detectLimit') ?? SHORTFALL_DETECT_LIMIT_DEFAULT
    );
    const closeLimit = resolveSweepBudget(
      this.getNumber(job, 'closeLimit') ?? SHORTFALL_CLOSE_LIMIT_DEFAULT
    );
    const lockKey = reservationShortfallLockKey(scopeId);
    const lockTtlMs = resolveSweepLockTtlMs(
      this.configService.get<string>('OL_MASTER_SWEEP_LOCK_TTL_MS')
    );

    const lockToken = await this.syncLock.acquire(lockKey, lockTtlMs);
    if (lockToken === null) {
      this.logger.log(
        `inventory.reservations.shortfall skipped: ${lockKey} already in progress`
      );
      return { outcome: 'ok' };
    }

    try {
      const detectOffset = this.parseOffset(
        await this.cursors.getCursor(scopeId, DETECT_CURSOR_KEY)
      );
      const closeOffset = this.parseOffset(
        await this.cursors.getCursor(scopeId, CLOSE_CURSOR_KEY)
      );

      const result = await this.shortfalls.detectShortfalls({
        detectLimit,
        closeLimit,
        detectOffset,
        closeOffset,
      });

      this.logger.log(
        `inventory.reservations.shortfall: positionsExamined=${String(result.positionsExamined)}, ` +
          `episodesOpened=${String(result.episodesOpened)}, ` +
          `episodesStillOpen=${String(result.episodesStillOpen)}, ` +
          `episodesExamined=${String(result.episodesExamined)}, ` +
          `episodesClosed=${String(result.episodesClosed)}, ` +
          `unattributed=${String(result.unattributed)}, failed=${String(result.failed)}, ` +
          `nextDetectOffset=${String(result.nextDetectOffset)}, ` +
          `nextCloseOffset=${String(result.nextCloseOffset)}`
      );

      if (result.episodesOpened > 0) {
        // Surfaced with job context as well as from the service, because the
        // number an operator acts on is the per-run one. `W2-15`'s
        // needs-attention reason set (RS-S) does not exist on this branch, so
        // the counter and this line ARE the signal — no fact is emitted into a
        // sink that does not exist.
        this.logger.warn(
          `inventory.reservations.shortfall: ${String(result.episodesOpened)} order(s) are ` +
            `newly short of stock OpenLinker already promised. Nothing was reduced ` +
            `silently — each is recorded as an episode naming the order and the sku.`
        );
      }

      if (result.unattributed > 0) {
        this.logger.error(
          `inventory.reservations.shortfall: ${String(result.unattributed)} shortfall unit(s) ` +
            `could not be attributed to any order — the position counter and the ` +
            `reservation ledger disagree. The ledger is authoritative; investigate.`
        );
      }

      // Cursors are written only after a successful run. A failure leaves both
      // where they were, so the same page is re-read rather than skipped — and
      // re-reading is free, because opening is idempotent against the partial
      // unique index and closing is guarded on `closedAt IS NULL`.
      await this.cursors.advanceCursor(
        scopeId,
        DETECT_CURSOR_KEY,
        String(result.nextDetectOffset)
      );
      await this.cursors.advanceCursor(
        scopeId,
        CLOSE_CURSOR_KEY,
        String(result.nextCloseOffset)
      );

      return { outcome: 'ok' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SyncJobExecutionError(
        `inventory.reservations.shortfall failed: ${message}`,
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

  private getNumber(job: SyncJob, key: 'detectLimit' | 'closeLimit'): number | undefined {
    const payload = job.payload as Record<string, unknown> | null | undefined;
    const value = payload?.[key];
    return typeof value === 'number' ? value : undefined;
  }

  /**
   * A malformed or absent cursor starts a fresh cycle rather than wedging the
   * pass — the #2218 precedent for a defensively-parsed cursor.
   */
  private parseOffset(stored: string | null | undefined): number {
    if (stored === null || stored === undefined || stored === '') {
      return 0;
    }
    const parsed = Number(stored);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
  }
}

export { SHORTFALL_DETECT_LIMIT_DEFAULT, SHORTFALL_CLOSE_LIMIT_DEFAULT };
