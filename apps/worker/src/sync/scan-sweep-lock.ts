/**
 * Per-connection exclusivity for the rolling scan sweeps (#2594 review).
 *
 * These sweeps read a scan cursor, do a page of work, then write the cursor
 * back. That is a read-modify-write, and it was only safe because the `bulk`
 * lane's per-scope cap used to be 1: two ticks of one connection's sweep could
 * never overlap. #2594 raised that cap to 8, which is the point of the change,
 * and it removed the serialisation these sweeps were relying on without owning
 * a lock of their own. Two overlapping runs race the cursor - one advances past
 * the page the other is still reading, so a whole cycle of offers is skipped
 * with no error anywhere.
 *
 * The shape is the one the catalogue enumerators already use and have proven
 * (`sweepLockKey` in `bounded-sweep.ts`): a per-(kind, connection) lock,
 * contention is not a failure, and the TTL bounds a lost release. It lives in
 * one helper because six handlers need it and a per-handler copy is six places
 * for the release to be forgotten.
 *
 * Not every unlocked `bulk` sweep needs this. `marketplace.order.fxStampSweep`
 * and `marketplace.offer.pauseStaleSweep` keep no cursor: they re-derive their
 * work from a predicate every run and their writes are conditional, so two
 * overlapping runs duplicate reads and converge on the same state rather than
 * skipping work.
 *
 * @module apps/worker/src/sync
 */
import type { SyncJobHandlerResult, SyncLockPort } from '@openlinker/core/sync';
import type { Logger } from '@openlinker/shared/logging';
import { resolveSweepLockTtlMs } from './bounded-sweep';

/**
 * The scan-sweep families that own a lock namespace.
 *
 * One entry per cursor, not per job type: a family shares a lock exactly when
 * its members share the cursor they would race on.
 */
export type ScanSweepKind =
  | 'offer-status'
  | 'offer-mapping'
  | 'shop-product-status'
  | 'shipment-status'
  | 'fulfillment-status'
  | 'orders-tax-rate';

/** `scan:{kind}:sweep:{connectionId}` - one in-flight run per connection. */
export function scanSweepLockKey(kind: ScanSweepKind, connectionId: string): string {
  return `scan:${kind}:sweep:${connectionId}`;
}

/**
 * Run one page of a scan sweep with at most one run per connection in flight.
 *
 * A contended run reports `ok` and does nothing, matching the catalogue sweeps:
 * the holder is doing this connection's work, and the cursor has not moved, so
 * the next tick continues from where the holder leaves it. Throwing instead
 * would spend a retry attempt on a healthy condition.
 */
export async function runExclusiveScanSweep(input: {
  syncLock: SyncLockPort;
  kind: ScanSweepKind;
  connectionId: string;
  lockTtlMs: number;
  jobType: string;
  logger: Logger;
  run: () => Promise<SyncJobHandlerResult>;
}): Promise<SyncJobHandlerResult> {
  const lockKey = scanSweepLockKey(input.kind, input.connectionId);
  const lockToken = await input.syncLock.acquire(lockKey, input.lockTtlMs);
  if (lockToken === null) {
    input.logger.log(
      `${input.jobType} skipped for connection ${input.connectionId}: ${lockKey} already in progress`
    );
    return { outcome: 'ok' };
  }

  try {
    return await input.run();
  } finally {
    try {
      await input.syncLock.release(lockKey, lockToken);
    } catch (releaseError) {
      input.logger.warn(
        `Failed to release ${lockKey}: ${releaseError instanceof Error ? releaseError.message : String(releaseError)}`
      );
    }
  }
}

/**
 * Same clamped TTL policy as the catalogue sweeps, its own env var.
 *
 * A scan page is short work, but the ceiling that matters is the same one:
 * long enough that a slow page cannot lose its lock mid-run, short enough that
 * a crashed run does not hold the connection for a cycle.
 */
export function resolveScanSweepLockTtlMs(raw: string | undefined): number {
  return resolveSweepLockTtlMs(raw);
}
