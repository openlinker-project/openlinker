/**
 * Order-feed seeding helper
 *
 * A connection's order feed starts from "now" (#4228): its FIRST poll records
 * where the feed stands and imports nothing that already exists. A spec that
 * creates an order in the shop and then triggers `marketplace.orders.poll` on a
 * connection that may never have polled would have that very first poll consume
 * the order's moment, and the order would be skipped for good.
 *
 * `ensureOrderFeedSeeded` runs that first poll BEFORE the spec creates its
 * order, so the poll that follows starts from a recorded position. It is cheap
 * and idempotent (a connection that already polled just polls again), and it
 * remembers which connections it has already handled in this worker.
 *
 * @module support
 */
import type { ApiClient } from '../api/api-client';
import type { SyncJobs } from './jobs';
import { JobType } from './jobs';

const seeded = new Set<string>();

export async function ensureOrderFeedSeeded(
  _api: ApiClient,
  jobs: SyncJobs,
  connectionId: string,
): Promise<void> {
  if (seeded.has(connectionId)) return;
  // A poll that cannot be completed is a slower path to the same answer, not a
  // reason to fail the spec that only wanted the feed seeded.
  await jobs
    .triggerAndWait(
      { connectionId, jobType: JobType.marketplaceOrdersPoll },
      { expectSuccess: false, timeoutMs: 120_000 },
    )
    .then(() => seeded.add(connectionId))
    .catch(() => undefined);
}
