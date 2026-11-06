/**
 * Connection health - row ordering and the summary counts (#4016).
 *
 * Pure helpers behind the Insights "Connection health" panel, kept apart from
 * the component so the ordering rule and the counts are testable on their own.
 *
 * Two facts are deliberately kept separate here. A connection's own `status`
 * says whether OpenLinker can talk to the platform; its dead-job count says
 * whether work for it stopped retrying. The panel used to fold the second into
 * the first (an amber "ACTIVE"), which read as "the connection is broken" when
 * only its jobs were.
 *
 * @module pages/insights
 */
import type { Connection, ConnectionStatus } from '../../features/connections';

export interface ConnectionHealthRow {
  connection: Connection;
  deadJobCount: number;
}

/** The three buckets the health strip and its legend count. `off` covers a
 *  connection the operator switched off or archived. */
export type ConnectionHealthBucket = 'attention' | 'healthy' | 'off';

export interface ConnectionHealthSummary {
  total: number;
  /** Connections with at least one dead job. */
  withFailedJobs: number;
  attention: number;
  healthy: number;
  off: number;
}

const BROKEN_STATUSES: ReadonlySet<ConnectionStatus> = new Set(['error', 'needs_reauth']);

/**
 * A connection needs attention when its jobs stopped retrying or OpenLinker
 * can no longer reach the platform. A disabled connection is neither: the
 * operator switched it off, so it is counted on its own.
 */
export function bucketOf(row: ConnectionHealthRow): ConnectionHealthBucket {
  if (row.deadJobCount > 0 || BROKEN_STATUSES.has(row.connection.status)) return 'attention';
  if (row.connection.status === 'disabled' || row.connection.status === 'archived') return 'off';
  return 'healthy';
}

/** Most failed jobs first, then broken connections, then by name. */
export function sortConnectionHealthRows(
  rows: readonly ConnectionHealthRow[]
): ConnectionHealthRow[] {
  return [...rows].sort((a, b) => {
    if (b.deadJobCount !== a.deadJobCount) return b.deadJobCount - a.deadJobCount;
    const rank = (row: ConnectionHealthRow): number => {
      const bucket = bucketOf(row);
      return bucket === 'attention' ? 0 : bucket === 'healthy' ? 1 : 2;
    };
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return a.connection.name.localeCompare(b.connection.name);
  });
}

export function summarizeConnectionHealth(
  rows: readonly ConnectionHealthRow[]
): ConnectionHealthSummary {
  const summary: ConnectionHealthSummary = {
    total: rows.length,
    withFailedJobs: 0,
    attention: 0,
    healthy: 0,
    off: 0,
  };
  for (const row of rows) {
    if (row.deadJobCount > 0) summary.withFailedJobs += 1;
    summary[bucketOf(row)] += 1;
  }
  return summary;
}

/** The one-sentence summary above the list. */
export function describeConnectionHealth(summary: ConnectionHealthSummary): string {
  const plural = summary.total === 1 ? 'connection' : 'connections';
  if (summary.withFailedJobs === 0) {
    return summary.attention === 0
      ? `No failed jobs on any of your ${summary.total} ${plural}.`
      : `No failed jobs, but ${summary.attention} of ${summary.total} ${plural} cannot reach their platform.`;
  }
  const verb = summary.withFailedJobs === 1 ? 'has' : 'have';
  return `${summary.withFailedJobs} of ${summary.total} ${plural} ${verb} jobs that stopped retrying.`;
}

export const CONNECTION_STATUS_LABEL: Record<ConnectionStatus, string> = {
  active: 'Active',
  disabled: 'Disabled',
  error: 'Error',
  needs_reauth: 'Needs re-auth',
  archived: 'Archived',
};
