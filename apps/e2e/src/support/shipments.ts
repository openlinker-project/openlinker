/**
 * Shipment tracking-number backfill poller
 *
 * The InPost ShipX sandbox mints a shipment's `tracking_number` only once the
 * shipment is `confirmed`; it is NOT present in the response right after label
 * creation. OL backfills `Shipment.trackingNumber` from the carrier-generic
 * `marketplace.shipment.statusSync` poll (#838) — the fix chain #1426 threads
 * ShipX `tracking_number` through the tracking snapshot, and the status-sync
 * service diffs it onto the row without overwriting.
 *
 * `waitForTrackingBackfill` drives that status-sync poll (rather than waiting on
 * the 30-min scheduled cron) and re-reads the shipment until the tracking number
 * appears or a bounded budget elapses. It never throws on timeout: the caller
 * asserts a non-null result on success and annotates the documented sandbox
 * timing on `timedOut`, so an attended golden-path run is not failed by a purely
 * sandbox-side delay.
 *
 * @module support
 * @see {@link SyncJobs.syncShipmentStatus}
 */
import type { ApiClient } from '../api/api-client';
import type { Shipment } from '../api/api.types';
import type { SyncJobs } from './jobs';

export interface TrackingBackfillOptions {
  /** Total budget before giving up (ms). Default 120s. */
  timeoutMs?: number;
  /** Delay between attempts (ms). Default 5s. */
  intervalMs?: number;
  /**
   * Drive `marketplace.shipment.statusSync` on the InPost connection before each
   * re-read so the backfill runs without waiting on the scheduled cron.
   * Default true.
   */
  driveStatusSync?: boolean;
}

export interface TrackingBackfillResult {
  /** The most recent shipment read. */
  shipment: Shipment;
  /** The backfilled tracking number, or null if it never appeared. */
  trackingNumber: string | null;
  /** True when the budget elapsed before the tracking number was minted. */
  timedOut: boolean;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_INTERVAL_MS = 5_000;

/**
 * Poll a shipment until OL backfills its tracking number, driving the InPost
 * status-sync job each attempt. Returns as soon as `trackingNumber` is non-null;
 * on timeout returns the last read with `timedOut: true` (never throws).
 */
export async function waitForTrackingBackfill(
  api: ApiClient,
  jobs: SyncJobs,
  input: { shipmentId: string; inpostConnectionId: string },
  options: TrackingBackfillOptions = {},
): Promise<TrackingBackfillResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const driveStatusSync = options.driveStatusSync ?? true;
  const deadline = Date.now() + timeoutMs;

  let shipment = await api.shipments.getById(input.shipmentId);
  while (shipment.trackingNumber == null && Date.now() < deadline) {
    if (driveStatusSync) {
      // Best-effort: force the carrier-generic status poll that backfills
      // tracking. A short per-attempt budget keeps the loop responsive; errors
      // (a stray business failure on an unrelated page) are swallowed so the
      // wait proceeds to the next re-read.
      await jobs
        .syncShipmentStatus(input.inpostConnectionId, { timeoutMs: intervalMs * 2 })
        .catch(() => undefined);
    }
    await delay(intervalMs);
    shipment = await api.shipments.getById(input.shipmentId);
  }

  return {
    shipment,
    trackingNumber: shipment.trackingNumber,
    timedOut: shipment.trackingNumber == null,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
