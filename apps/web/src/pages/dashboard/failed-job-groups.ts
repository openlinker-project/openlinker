/**
 * Failed-job grouping helpers for the dashboard triage surface.
 *
 * Groups dead sync jobs by `(connectionId, jobType)` so an operator sees the
 * pattern instead of N individual rows with the same signature. Each group
 * carries enough context to drive the Retry / View actions.
 *
 * @module pages/dashboard
 */
import type { SyncJob } from '../../features/sync-jobs/api/sync-jobs.types';

export interface FailedJobGroup {
  /** Stable key: `${connectionId}::${jobType}`. */
  key: string;
  connectionId: string;
  jobType: string;
  count: number;
  /** Representative job (most recently updated) used for Retry / View. */
  representative: SyncJob;
  /** Last error from the representative row; often the same across the group. */
  lastError: string | null;
  /** Most recent `updatedAt` in the group — drives sort order. */
  latestUpdatedAt: string;
}

/**
 * Group dead jobs by connection + job type, ordered by most recent failure.
 */
export function groupFailedJobs(jobs: SyncJob[]): FailedJobGroup[] {
  const buckets = new Map<string, FailedJobGroup>();

  for (const job of jobs) {
    const key = `${job.connectionId}::${job.jobType}`;
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, {
        key,
        connectionId: job.connectionId,
        jobType: job.jobType,
        count: 1,
        representative: job,
        lastError: job.lastError,
        latestUpdatedAt: job.updatedAt,
      });
      continue;
    }

    existing.count += 1;
    if (job.updatedAt > existing.latestUpdatedAt) {
      existing.latestUpdatedAt = job.updatedAt;
      existing.representative = job;
      existing.lastError = job.lastError;
    }
  }

  return Array.from(buckets.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return b.latestUpdatedAt.localeCompare(a.latestUpdatedAt);
  });
}

export interface ConnectionFailureSignal {
  connectionId: string;
  deadJobCount: number;
}

/**
 * Collapse dead-job totals per connection so the Connection health card can
 * show a warning roll-up even when the DB row still reads `status=active`.
 */
export function summarizeFailuresByConnection(
  jobs: SyncJob[],
): Map<string, ConnectionFailureSignal> {
  const byConnection = new Map<string, ConnectionFailureSignal>();
  for (const job of jobs) {
    const existing = byConnection.get(job.connectionId);
    if (existing) {
      existing.deadJobCount += 1;
    } else {
      byConnection.set(job.connectionId, { connectionId: job.connectionId, deadJobCount: 1 });
    }
  }
  return byConnection;
}
